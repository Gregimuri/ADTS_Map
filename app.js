// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let map;
let markerCluster;
let allPoints = [];
let activeFilters = {
    projects: [],
    regions: [],
    statuses: [],
    managers: []
};

let updateInterval;
let geocodingSystem = null;
let markersMap = new Map();
let isLoading = false;

// ========== КЛАСС ГЕОКОДИРОВАНИЯ ==========

class GeocodingSystem {
    constructor() {
        this.cache = new Map();
        this.queue = [];
        this.processing = false;
        this.stats = {
            total: 0,
            nominatim: 0,
            yandex: 0,
            overpass: 0,
            cached: 0,
            failed: 0,
            approximate: 0,
            proxySwitches: 0
        };
        this.loadCache();
        this.currentProxyIndex = 0;
    }
    
    loadCache() {
        try {
            const cached = localStorage.getItem('geocoding_cache');
            if (cached) {
                const data = JSON.parse(cached);
                const cacheDays = CONFIG.GEOCODING?.cacheDays || 30;
                const maxAge = cacheDays * 24 * 60 * 60 * 1000;
                
                if (Date.now() - data.timestamp < maxAge) {
                    this.cache = new Map(Object.entries(data.cache));
                    console.log(`✅ Кэш загружен: ${this.cache.size} записей`);
                } else {
                    console.log('⚠️ Кэш устарел');
                    localStorage.removeItem('geocoding_cache');
                }
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки кэша:', error);
        }
    }
    
    saveCache() {
        try {
            const cacheData = {
                cache: Object.fromEntries(this.cache),
                timestamp: Date.now()
            };
            localStorage.setItem('geocoding_cache', JSON.stringify(cacheData));
        } catch (error) {
            console.error('❌ Ошибка сохранения кэша:', error);
        }
    }
    
    // УЛУЧШЕННАЯ НОРМАЛИЗАЦИЯ АДРЕСОВ ДЛЯ OSM
    normalizeRussianAddress(address, region = '') {
        if (!address) return '';
        
        let normalized = address.toString().trim();
        const original = normalized;
        
        // 1. Удаляем почтовый индекс
        normalized = normalized.replace(/^\d{6},?\s*/, '');
        normalized = normalized.replace(/,\s*\d{6}$/, '');
        
        // 2. Удаляем скобки и их содержимое
        normalized = normalized.replace(/\([^)]*\)/g, '');
        normalized = normalized.replace(/\[[^\]]*\]/g, '');
        
        // 3. Удаляем указания на населенные пункты в скобках
        normalized = normalized.replace(/\(Нас\.?пункт\)/gi, '');
        normalized = normalized.replace(/\([^)]*Нас\.?[^)]*\)/gi, '');
        
        // 4. Обрабатываем специальные случаи для ваших примеров
        normalized = normalized.replace(/Алтайский край \/ Алтайский край,/gi, 'Алтайский край,');
        normalized = normalized.replace(/Алтайский крайул\./gi, 'Алтайский край, г. Барнаул, ул.');
        normalized = normalized.replace(/ул\. Барнаул /gi, 'г. Барнаул, ул. ');
        
        // 5. Нормализуем регион
        if (region && !normalized.includes(region)) {
            normalized = region + ', ' + normalized;
        }
        
        // 6. Заменяем сокращения на полные названия для лучшего распознавания OSM
        const replacements = {
            'обл': 'область',
            'респ': 'республика',
            'край': 'край',
            'г': 'город',
            'пгт': 'поселок городского типа',
            'рп': 'рабочий поселок',
            'с': 'село',
            'д': 'деревня',
            'ст-ца': 'станица',
            'ул': 'улица',
            'пр-кт': 'проспект',
            'пер': 'переулок',
            'ш': 'шоссе',
            'б-р': 'бульвар',
            'пр-д': 'проезд',
            'пл': 'площадь',
            'мкр': 'микрорайон',
            'кв-л': 'квартал',
            'пом': 'помещение',
            'корп': 'корпус',
            'стр': 'строение',
            'влд': 'владение',
            'зд': 'здание',
            'лит': 'литера'
        };
        
        Object.entries(replacements).forEach(([short, full]) => {
            const regex = new RegExp(`\\b${short}\\.?\\b`, 'gi');
            normalized = normalized.replace(regex, full);
        });
        
        // 7. Обрабатываем номера домов (особенно важно для OSM)
        normalized = normalized.replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2'); // 114/1
        normalized = normalized.replace(/(\д|\дом)\s*№?\s*(\d+)/gi, 'дом $2');
        normalized = normalized.replace(/дом\s*№?\s*зд\.?\s*(\d+[а-я]?)/gi, 'дом $1');
        normalized = normalized.replace(/корпус\s*№?\s*(\d+)/gi, 'корпус $1');
        
        // 8. Удаляем лишние слова и сокращения
        const stopWords = [
            'нас\\.?\\s*пункт', 'торговая точка', 'торг\\s*точка', 'тт',
            'магазин', 'здание', 'помещ[ение\\.]*', 'пом\\.?',
            'владение\\s*\\d+', 'влад\\.?\\s*\\d+',
            'жилой комплекс', 'жк', 'микрорайон', 'мкр\\.?',
            'помещение\\s*\\d+', 'пом\\.?\\s*\\d+'
        ];
        
        stopWords.forEach(pattern => {
            const regex = new RegExp(pattern, 'gi');
            normalized = normalized.replace(regex, '');
        });
        
        // 9. Чистка и форматирование
        normalized = normalized.replace(/\s+/g, ' ');
        normalized = normalized.replace(/,\s*,/g, ',');
        normalized = normalized.replace(/\s*,\s*/g, ', ');
        normalized = normalized.trim();
        
        // 10. Разбиваем на части и упорядочиваем
        const parts = normalized.split(',').map(p => p.trim()).filter(p => p);
        
        if (parts.length >= 3) {
            const sortedParts = [];
            const regionKeywords = ['область', 'край', 'республика', 'ао'];
            const settlementKeywords = ['город', 'поселок городского типа', 'рабочий поселок', 'село', 'деревня', 'станица'];
            const streetKeywords = ['улица', 'проспект', 'переулок', 'шоссе', 'бульвар', 'проезд'];
            
            // Регион
            const regionPart = parts.find(p => regionKeywords.some(kw => p.toLowerCase().includes(kw)));
            if (regionPart) sortedParts.push(regionPart);
            
            // Населенный пункт
            const settlementPart = parts.find(p => settlementKeywords.some(kw => p.toLowerCase().includes(kw)));
            if (settlementPart && settlementPart !== regionPart) sortedParts.push(settlementPart);
            
            // Улица
            const streetPart = parts.find(p => streetKeywords.some(kw => p.toLowerCase().includes(kw)));
            if (streetPart && !sortedParts.includes(streetPart)) sortedParts.push(streetPart);
            
            // Дом
            const housePart = parts.find(p => 
                (p.toLowerCase().includes('дом') || p.toLowerCase().includes('корпус') || 
                 p.match(/\d+[а-я]?\b/) || p.match(/\d+\/\d+/)) && 
                !sortedParts.includes(p)
            );
            if (housePart) sortedParts.push(housePart);
            
            // Остальные части
            parts.forEach(part => {
                if (!sortedParts.includes(part) && part) {
                    sortedParts.push(part);
                }
            });
            
            normalized = sortedParts.join(', ');
        }
        
        // 11. Капитализация
        normalized = normalized.split(' ').map(word => {
            if (word.includes('-')) {
                return word.split('-').map(part => 
                    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
                ).join('-');
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
        
        // 12. Добавляем "Россия" если не указано
        if (!normalized.toLowerCase().includes('россия') && 
            !normalized.toLowerCase().includes('russia')) {
            normalized = normalized + ', Россия';
        }
        
        console.log(`🔧 Нормализация: "${original}" → "${normalized}"`);
        return normalized.trim();
    }
    
    // УЛУЧШЕННАЯ ФУНКЦИЯ ГЕОКОДИРОВАНИЯ OSM
    async geocodeNominatim(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            // Получаем нормализованный адрес
            let normalized = this.normalizeRussianAddress(address, region);
            normalized = normalized.replace(/,\s*Россия$/i, '');
            
            if (!normalized || normalized.length < 5) {
                console.log('❌ Слишком короткий адрес для OSM');
                return null;
            }
            
            // Проверяем кэш
            const cached = this.getFromCache(address, region);
            if (cached) {
                return cached;
            }
            
            // Соблюдаем задержку для OSM
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.nominatim || 1000));
            
            // Генерируем варианты запросов для OSM
            const queries = this.generateOSMQueries(normalized, region);
            console.log(`🔍 OSM запросы:`, queries);
            
            for (const query of queries) {
                try {
                    console.log(`🌍 OSM пробуем: "${query.substring(0, 80)}..."`);
                    const result = await this.queryNominatimExact(query);
                    
                    if (result) {
                        console.log(`✅ OSM нашел точные координаты: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`);
                        this.stats.nominatim++;
                        
                        // Сохраняем в кэш
                        this.saveToCache(address, region, result.lat, result.lng, 'nominatim', true);
                        
                        return {
                            lat: result.lat,
                            lng: result.lng,
                            source: 'nominatim',
                            isExact: true,
                            normalized: normalized,
                            displayName: result.displayName
                        };
                    }
                    
                    // Задержка между попытками
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (e) {
                    console.warn(`⚠️ Ошибка OSM запроса:`, e.message);
                    continue;
                }
            }
            
            console.log(`❌ OSM не нашел точный адрес: ${normalized.substring(0, 60)}...`);
            return null;
            
        } catch (error) {
            console.warn('❌ Ошибка OSM геокодирования:', error.message);
            return null;
        }
    }
    
    // ГЕНЕРАЦИЯ ВАРИАНТОВ ЗАПРОСОВ ДЛЯ OSM
    generateOSMQueries(address, region = '') {
        const parts = address.split(',').map(p => p.trim()).filter(p => p);
        const queries = new Set();
        
        // 1. Полный адрес
        queries.add(address);
        
        // 2. Без региона (если есть)
        if (parts.length > 1 && (
            parts[0].toLowerCase().includes('область') || 
            parts[0].toLowerCase().includes('край') ||
            parts[0].toLowerCase().includes('республика')
        )) {
            queries.add(parts.slice(1).join(', '));
        }
        
        // 3. Ищем населенный пункт
        const settlementIndex = parts.findIndex(p => 
            p.toLowerCase().includes('город') ||
            p.toLowerCase().includes('поселок') ||
            p.toLowerCase().includes('село') ||
            p.toLowerCase().includes('деревня') ||
            p.toLowerCase().includes('станица')
        );
        
        if (settlementIndex !== -1) {
            // Населенный пункт + улица + дом
            if (settlementIndex + 2 < parts.length) {
                const settlementStreetHouse = parts.slice(settlementIndex, settlementIndex + 3).join(', ');
                queries.add(settlementStreetHouse);
            }
            
            // Населенный пункт + улица
            if (settlementIndex + 1 < parts.length) {
                const settlementStreet = parts.slice(settlementIndex, settlementIndex + 2).join(', ');
                queries.add(settlementStreet);
            }
            
            // Только населенный пункт
            queries.add(parts[settlementIndex]);
        }
        
        // 4. Убираем номер дома для поиска улицы
        const withoutHouse = address.replace(/,\s*дом\s*\d+.*$/i, '')
                                   .replace(/,\s*корпус\s*\d+.*$/i, '')
                                   .replace(/,\s*строение\s*\d+.*$/i, '');
        if (withoutHouse !== address) {
            queries.add(withoutHouse.trim());
        }
        
        // 5. Для сложных адресов с дробями (114/1)
        const fractionMatch = address.match(/(\d+\/\d+)/);
        if (fractionMatch) {
            const withoutFraction = address.replace(fractionMatch[0], '').replace(/,\s*,/, ',').trim();
            if (withoutFraction) queries.add(withoutFraction);
        }
        
        // Фильтруем короткие запросы
        return Array.from(queries).filter(q => q && q.length >= 10);
    }
    
    // ЗАПРОС К NOMINATIM С ДОМОМ
    async queryNominatimExact(query) {
        const encoded = encodeURIComponent(query);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=5&countrycodes=ru&accept-language=ru&addressdetails=1&namedetails=1`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': CONFIG.GEOCODING.osmUserAgent,
                    'Accept': 'application/json',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data && data.length > 0) {
                    // Ищем самый точный результат (с номером дома)
                    const exactResult = data.find(item => 
                        item.address && 
                        (item.address.house_number || 
                         item.type === 'house' || 
                         item.class === 'building')
                    );
                    
                    const result = exactResult || data[0];
                    
                    const lat = parseFloat(result.lat);
                    const lon = parseFloat(result.lon);
                    
                    // Проверяем, что координаты в России
                    if (lon >= 19 && lon <= 180 && lat >= 41 && lat <= 82) {
                        return {
                            lat: lat,
                            lng: lon,
                            displayName: result.display_name || '',
                            address: result.address || {},
                            type: result.type || result.class
                        };
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('⏰ Таймаут OSM запроса');
            } else {
                console.warn('⚠️ Ошибка OSM:', error.message);
            }
            throw error;
        }
        
        return null;
    }
    
    // ОСНОВНАЯ ФУНКЦИЯ ГЕОКОДИРОВАНИЯ С ИЗМЕНЕННЫМ ПОРЯДКОМ
    async geocode(address, region = '', pointId = null) {
        if (!CONFIG.GEOCODING?.enabled || !address) {
            return this.getApproximateCoordinates(address, region);
        }
        
        this.stats.total++;
        
        console.log(`🔍 Геокодирование: "${address.substring(0, 80)}..."`);
        
        // Проверка кэша
        const cached = this.getFromCache(address, region);
        if (cached) {
            return cached;
        }
        
        const normalized = this.normalizeRussianAddress(address, region);
        
        // ИЗМЕНЕННЫЙ ПОРЯДОК СЕРВИСОВ: сначала OSM, потом Яндекс
        const serviceOrder = CONFIG.GEOCODING.serviceOrder || ['nominatim', 'yandex', 'overpass'];
        
        const serviceMap = {
            'nominatim': () => this.geocodeNominatim(address, region),
            'yandex': () => this.geocodeYandex(address, region),
            'overpass': () => this.geocodeOverpassAPI(address, region)
        };
        
        let result = null;
        let usedService = 'none';
        
        for (const serviceName of serviceOrder) {
            if (!serviceMap[serviceName]) continue;
            
            try {
                console.log(`🔄 Пробуем ${serviceName}...`);
                result = await serviceMap[serviceName]();
                
                if (result) {
                    usedService = serviceName;
                    break;
                }
                
            } catch (error) {
                console.warn(`⚠️ ${serviceName} ошибка:`, error.message);
                continue;
            }
            
            // Задержка между сервисами
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Обработка результатов
        if (result) {
            if (result.isExact || result.source === 'nominatim') {
                // Сохраняем точные координаты
                this.saveToCache(address, region, result.lat, result.lng, usedService, true);
                
                if (pointId) {
                    this.updatePointAndMarker(pointId, result.lat, result.lng, usedService);
                }
                
                return result;
            } else {
                // Приблизительные координаты
                this.stats.approximate++;
                this.saveToCache(address, region, result.lat, result.lng, usedService, false);
                return result;
            }
        }
        
        // Если ничего не найдено
        this.stats.failed++;
        const approximate = this.getApproximateCoordinates(address, region);
        this.saveToCache(address, region, approximate.lat, approximate.lng, 'approximate', false);
        
        return approximate;
    }
    
    // Остальные методы класса остаются без изменений...
    // (getCacheKey, getFromCache, saveToCache, geocodeYandex, geocodeOverpassAPI и т.д.)
    // ...
}

// ========== ВИЗУАЛЬНЫЕ УЛУЧШЕНИЯ ==========

// Обновленная функция создания маркера
function createMarker(point) {
    let color = CONFIG.STATUS_COLORS.default;
    const status = point.status || '';
    const statusLower = status.toLowerCase();
    
    if (status === 'Активная' || statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
    } else if (status === 'На паузе' || statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
    } else if (status === 'Закрыта' || statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (status === 'План' || statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    // Индикатор точности координат
    let accuracyBadge = '';
    if (point.isMock) {
        accuracyBadge = `
            <div style="
                position: absolute;
                top: -5px;
                right: -5px;
                width: 12px;
                height: 12px;
                background: #f39c12;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            " title="Приблизительные координаты"></div>
        `;
    } else if (point.geocodingSource === 'nominatim') {
        accuracyBadge = `
            <div style="
                position: absolute;
                top: -5px;
                right: -5px;
                width: 12px;
                height: 12px;
                background: #2ecc71;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            " title="Точные координаты (OSM)"></div>
        `;
    }
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
                <div style="
                    background: ${color};
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 3px 6px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 14px;
                    transition: all 0.3s;
                    cursor: pointer;
                ">
                    ${point.name ? point.name.charAt(0).toUpperCase() : 'Т'}
                </div>
                ${accuracyBadge}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 36]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        pointId: point.id,
        isMock: point.isMock || false
    });
    
    marker.bindPopup(createPopupContent(point));
    marker.on('click', function() {
        showPointDetails(point);
        // Анимация при клике
        const markerElement = marker.getElement();
        if (markerElement) {
            markerElement.style.transform = 'scale(1.2)';
            setTimeout(() => {
                markerElement.style.transform = 'scale(1)';
            }, 300);
        }
    });
    
    marker.on('mouseover', function() {
        const markerElement = marker.getElement();
        if (markerElement) {
            markerElement.style.transform = 'scale(1.1)';
            markerElement.style.zIndex = '1000';
        }
    });
    
    marker.on('mouseout', function() {
        const markerElement = marker.getElement();
        if (markerElement) {
            markerElement.style.transform = 'scale(1)';
            markerElement.style.zIndex = 'auto';
        }
    });
    
    return marker;
}

// Улучшенный popup
function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || CONFIG.STATUS_COLORS.default;
    
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.trim();
    }
    
    // Информация о точности
    let accuracyInfo = '';
    let accuracyIcon = '';
    let accuracyColor = '';
    
    if (point.isMock) {
        accuracyInfo = 'Приблизительные координаты';
        accuracyIcon = 'fa-exclamation-triangle';
        accuracyColor = '#f39c12';
    } else if (point.geocodingSource === 'nominatim') {
        accuracyInfo = 'Точные координаты (OpenStreetMap)';
        accuracyIcon = 'fa-check-circle';
        accuracyColor = '#2ecc71';
    } else if (point.geocodingSource === 'yandex') {
        accuracyInfo = 'Точные координаты (Яндекс Карты)';
        accuracyIcon = 'fa-check-circle';
        accuracyColor = '#2ecc71';
    } else if (point.geocodingSource) {
        accuracyInfo = `Координаты (${point.geocodingSource})`;
        accuracyIcon = 'fa-map-marker-alt';
        accuracyColor = '#3498db';
    }
    
    return `
        <div style="min-width: 280px; max-width: 350px; font-family: 'Segoe UI', Tahoma, sans-serif;">
            <div style="
                background: ${color};
                color: white;
                padding: 12px 15px;
                border-radius: 8px 8px 0 0;
                margin: -10px -10px 10px -10px;
            ">
                <h4 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-store"></i>
                    ${point.name || 'Без названия'}
                </h4>
            </div>
            
            <div style="margin-bottom: 12px;">
                <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 4px;">Статус</div>
                <div style="
                    display: inline-block;
                    background: ${color};
                    color: white;
                    padding: 4px 12px;
                    border-radius: 15px;
                    font-size: 13px;
                    font-weight: 500;
                ">
                    ${point.status || 'Не указан'}
                </div>
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 4px; display: flex; align-items: center; gap: 5px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес
                    </div>
                    <div style="font-size: 14px; line-height: 1.4;">${displayAddress}</div>
                </div>
            ` : ''}
            
            <div style="
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
                margin-bottom: 15px;
                padding: 12px;
                background: #f8f9fa;
                border-radius: 6px;
            ">
                ${point.region ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 2px;">Регион</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.region}</div>
                    </div>
                ` : ''}
                
                ${point.manager ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 2px;">Менеджер</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.manager}</div>
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 2px;">Подрядчик</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.contractor}</div>
                    </div>
                ` : ''}
                
                ${point.geocodingSource ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 2px;">Источник</div>
                        <div style="font-size: 13px; font-weight: 500;">
                            ${point.geocodingSource === 'nominatim' ? 'OSM' : 
                              point.geocodingSource === 'yandex' ? 'Яндекс' : 
                              point.geocodingSource}
                        </div>
                    </div>
                ` : ''}
            </div>
            
            ${point.lat && point.lng ? `
                <div style="
                    margin-bottom: 10px;
                    padding: 8px 10px;
                    background: #f1f8ff;
                    border-radius: 5px;
                    font-size: 11px;
                    color: #2c3e50;
                ">
                    <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 3px;">
                        <i class="fas fa-crosshairs"></i>
                        <strong>Координаты:</strong>
                    </div>
                    <div>Широта: ${point.lat.toFixed(6)}</div>
                    <div>Долгота: ${point.lng.toFixed(6)}</div>
                </div>
            ` : ''}
            
            ${accuracyInfo ? `
                <div style="
                    padding: 8px 12px;
                    background: ${accuracyColor}15;
                    border: 1px solid ${accuracyColor}30;
                    border-radius: 6px;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                ">
                    <i class="fas ${accuracyIcon}" style="color: ${accuracyColor};"></i>
                    <span style="color: #2c3e50;">${accuracyInfo}</span>
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ОБНОВЛЕННАЯ ФУНКЦИЯ ОТОБРАЖЕНИЯ ТОЧЕК ==========

function showPointsOnMap() {
    console.log('Показываю точки на карте...');
    
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`Фильтровано точек: ${filteredPoints.length}`);
    
    // Группируем точки по точности для красивого отображения
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock);
    const approxPoints = filteredPoints.filter(p => p.isMock);
    
    // Сначала добавляем приблизительные точки
    approxPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        }
    });
    
    // Затем точные точки (они будут поверх)
    exactPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        }
    });
    
    // Обновляем статистику
    updateStatistics();
    updateGeocodingStats();
    
    // Центрируем карту
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            filteredPoints
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { 
                padding: [50, 50], 
                maxZoom: 12,
                animate: true,
                duration: 1
            });
        }
    }
}

// ========== ОБНОВЛЕННЫЙ СТАТУС ГЕОКОДИРОВАНИЯ ==========

function updateGeocodingStats() {
    if (!geocodingSystem) return;
    
    const totalPoints = allPoints.length;
    const exactCoords = allPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const mockCoords = allPoints.filter(p => p.isMock).length;
    
    const statsElement = document.getElementById('geocoding-stats');
    if (!statsElement) return;
    
    const stats = geocodingSystem.stats;
    
    const exactPercentage = totalPoints > 0 ? Math.round((exactCoords / totalPoints) * 100) : 0;
    
    statsElement.innerHTML = `
        <div style="margin-top: 10px; padding: 12px; background: rgba(255,255,255,0.1); border-radius: 8px; border-left: 4px solid #3498db;">
            <div style="font-size: 12px; color: #ecf0f1; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-map-marker-alt"></i> 
                <span>Точность координат</span>
                <div style="margin-left: auto; font-size: 11px; color: #95a5a6;">${exactPercentage}%</div>
            </div>
            
            <div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 11px; color: #ecf0f1;">Точные координаты</span>
                    <span style="font-size: 11px; font-weight: bold; color: #2ecc71;">${exactCoords}</span>
                </div>
                <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div style="width: ${exactPercentage}%; height: 100%; background: #2ecc71; border-radius: 2px;"></div>
                </div>
            </div>
            
            <div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 11px; color: #ecf0f1;">Приблизительные</span>
                    <span style="font-size: 11px; font-weight: bold; color: #f39c12;">${mockCoords}</span>
                </div>
                <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div style="width: ${Math.round((mockCoords / totalPoints) * 100)}%; height: 100%; background: #f39c12; border-radius: 2px;"></div>
                </div>
            </div>
            
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 10px; color: #95a5a6;">
                    <div>
                        <i class="fas fa-database"></i> Кэш: ${stats.cached}
                    </div>
                    <div>
                        <i class="fas fa-globe-europe"></i> OSM: ${stats.nominatim}
                    </div>
                    <div>
                        <i class="fab fa-yandex"></i> Яндекс: ${stats.yandex}
                    </div>
                    <div>
                        <i class="fas fa-sync-alt"></i> Очередь: ${geocodingSystem.queue.length}
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ========== УЛУЧШЕННЫЙ ИНТЕРФЕЙС ПОЛЬЗОВАТЕЛЯ ==========

function showNotification(message, type = 'info', duration = 5000) {
    document.querySelectorAll('.notification').forEach(el => el.remove());
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    let icon = 'info-circle';
    let bgColor = '#3498db';
    let iconColor = '#3498db';
    
    switch(type) {
        case 'success':
            icon = 'check-circle';
            bgColor = '#2ecc71';
            iconColor = '#2ecc71';
            break;
        case 'error':
            icon = 'exclamation-circle';
            bgColor = '#e74c3c';
            iconColor = '#e74c3c';
            break;
        case 'warning':
            icon = 'exclamation-triangle';
            bgColor = '#f39c12';
            iconColor = '#f39c12';
            break;
        case 'info':
            icon = 'info-circle';
            bgColor = '#3498db';
            iconColor = '#3498db';
            break;
    }
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 20px;
            background: white;
            color: #2c3e50;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.15);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideIn 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            max-width: 400px;
            min-width: 300px;
            border-left: 4px solid ${bgColor};
            font-family: 'Segoe UI', Tahoma, sans-serif;
        ">
            <div style="
                width: 36px;
                height: 36px;
                background: ${bgColor}15;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <i class="fas fa-${icon}" style="color: ${iconColor}; font-size: 16px;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">
                    ${type === 'success' ? 'Успешно' : 
                      type === 'error' ? 'Ошибка' : 
                      type === 'warning' ? 'Внимание' : 'Информация'}
                </div>
                <div style="font-size: 13px; line-height: 1.4;">${message}</div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: none;
                border: none;
                color: #95a5a6;
                cursor: pointer;
                font-size: 14px;
                padding: 4px;
                border-radius: 4px;
                transition: all 0.2s;
            ">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentElement) notification.remove();
            }, 300);
        }
    }, duration);
}

// Добавляем CSS анимации
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { 
            transform: translateX(100%) translateY(-20px); 
            opacity: 0; 
        }
        to { 
            transform: translateX(0) translateY(0); 
            opacity: 1; 
        }
    }
    
    @keyframes slideOut {
        from { 
            transform: translateX(0) translateY(0); 
            opacity: 1; 
        }
        to { 
            transform: translateX(100%) translateY(-20px); 
            opacity: 0; 
        }
    }
    
    .custom-marker:hover {
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
    }
    
    .marker-updating {
        animation: markerPulse 1s infinite;
    }
    
    @keyframes markerPulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.15); }
        100% { transform: scale(1); }
    }
`;
document.head.appendChild(style);


// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========

function initApp() {
    console.log('Инициализация приложения...');
    initMap();
    
    if (CONFIG.GEOCODING?.enabled) {
        geocodingSystem = new GeocodingSystem();
        console.log('🚀 Система геокодирования инициализирована');
    }
    
    showDemoData();
    loadData();
    setupAutoUpdate();
    
    if (geocodingSystem) {
        setInterval(() => {
            if (geocodingSystem.queue.length > 0 && !geocodingSystem.processing) {
                geocodingSystem.processQueue();
            }
        }, 30000);
    }
}

document.addEventListener('DOMContentLoaded', initApp);

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========

function initMap() {
    console.log('Инициализация карты...');
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('Элемент карты не найден!');
        showNotification('Ошибка: элемент карты не найден', 'error');
        return;
    }
    
    try {
        map = L.map('map').setView(CONFIG.MAP.center, CONFIG.MAP.zoom);
        
        L.tileLayer(CONFIG.MAP.tileLayer, {
            attribution: CONFIG.MAP.attribution,
            maxZoom: 18
        }).addTo(map);
        
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 40,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                const markers = cluster.getAllChildMarkers();
                
                let color = CONFIG.STATUS_COLORS.default;
                const statuses = markers.map(m => m.options.status);
                
                if (statuses.includes('Закрыта')) {
                    color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
                } else if (statuses.includes('На паузе')) {
                    color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
                } else if (statuses.includes('Активная')) {
                    color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
                }
                
                return L.divIcon({
                    html: `<div style="background:${color}; color:white; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);">${count}</div>`,
                    className: 'custom-cluster',
                    iconSize: [40, 40]
                });
            }
        }).addTo(map);
        
        console.log('Карта успешно инициализирована');
    } catch (error) {
        console.error('Ошибка инициализации карты:', error);
        showNotification('Ошибка загрузки карты', 'error');
    }
}

// ========== УТИЛИТЫ ==========

function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.innerHTML = `<i class="fas fa-circle" style="color: #2ecc71;"></i> ${message}`;
    }
}

function showModal(title, message) {
    const modal = document.getElementById('modal');
    const titleElement = document.getElementById('modal-title');
    const messageElement = document.getElementById('modal-message');
    
    if (modal && titleElement && messageElement) {
        titleElement.textContent = title;
        messageElement.innerHTML = message;
        modal.style.display = 'flex';
    }
}

function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    document.querySelectorAll('.notification').forEach(el => el.remove());
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'exclamation-circle';
    else if (type === 'warning') icon = 'exclamation-triangle';
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#2ecc71' : 
                         type === 'error' ? '#e74c3c' : 
                         type === 'warning' ? '#f39c12' : '#3498db'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease;
            max-width: 400px;
        ">
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentElement) notification.remove();
            }, 300);
        }
    }, duration);
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function loadData() {
    if (isLoading) return;
    
    isLoading = true;
    
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        console.log('Начинаю загрузку данных...');
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Данные загружены: ${data.length} строк`);
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`Координаты добавлены: ${allPoints.length}`);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        if (CONFIG.GEOCODING?.enabled && CONFIG.GEOCODING.autoGeocode && geocodingSystem) {
            geocodingSystem.startBackgroundGeocoding();
        }
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        showNotification('Данные успешно загружены', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Используются демо-данные.', 'error');
        
        if (allPoints.length === 0) {
            showDemoData();
        }
        
    } finally {
        isLoading = false;
    }
}

async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&id=${CONFIG.SPREADSHEET_ID}`;
    
    console.log(`Загружаю CSV: ${url}`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        return parseCSV(csvText);
        
    } catch (error) {
        console.error('Ошибка загрузки CSV:', error);
        return null;
    }
}

function parseCSV(csvText) {
    try {
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const result = [];
        
        for (const line of lines) {
            const row = [];
            let current = '';
            let inQuotes = false;
            let quoteChar = '';
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = i + 1 < line.length ? line[i + 1] : '';
                
                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                    continue;
                }
                
                if (char === quoteChar && inQuotes) {
                    if (nextChar === quoteChar) {
                        current += char;
                        i++;
                        continue;
                    }
                    inQuotes = false;
                    quoteChar = '';
                    continue;
                }
                
                if (char === ',' && !inQuotes) {
                    row.push(current.trim());
                    current = '';
                    continue;
                }
                
                current += char;
            }
            
            row.push(current.trim());
            
            const cleanedRow = row.map(cell => {
                let cleaned = cell;
                if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
                    (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
                    cleaned = cleaned.substring(1, cleaned.length - 1);
                }
                cleaned = cleaned.replace(/""/g, '"');
                return cleaned;
            });
            
            if (cleanedRow.some(cell => cell.trim() !== '')) {
                result.push(cleanedRow);
            }
        }
        
        return result;
        
    } catch (error) {
        console.error('Ошибка парсинга CSV:', error);
        return [];
    }
}

// ========== ОБРАБОТКА ДАННЫХ ==========

function processData(rows) {
    console.log('Начинаю обработку данных...');
    
    if (!rows || rows.length < 2) {
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    const colIndices = findColumnIndices(headers);
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) {
            continue;
        }
        
        const point = {
            id: `point_${i}_${Date.now()}`,
            sheetRow: i + 1,
            name: '',
            region: '',
            address: '',
            status: '',
            manager: '',
            contractor: '',
            originalAddress: '',
            originalStatus: ''
        };
        
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length && row[index]) {
                const value = row[index].toString().trim();
                if (value) point[key] = value;
            }
        });
        
        if (point.address && geocodingSystem) {
            point.originalAddress = point.address;
            point.address = geocodingSystem.normalizeRussianAddress(point.address, point.region);
        }
        
        if (point.status && CONFIG.STATUS_MAPPING) {
            point.originalStatus = point.status;
            point.status = CONFIG.STATUS_MAPPING[point.status] || point.status;
        }
        
        if (!point.name || point.name.trim() === '') {
            if (point.address) {
                const firstPart = point.address.split(',')[0];
                point.name = firstPart.trim().substring(0, 30) + (firstPart.length > 30 ? '...' : '');
            } else if (point.region) {
                point.name = point.region + ' - Точка ' + i;
            } else {
                point.name = 'Точка ' + i;
            }
        }
        
        if (point.name || point.address || point.region) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек: ${points.length}`);
    return points;
}

function findColumnIndices(headers) {
    const indices = {
        name: -1,
        region: -1,
        address: -1,
        status: -1,
        manager: -1,
        contractor: -1
    };
    
    const headersLower = headers.map(h => h.toString().toLowerCase().trim());
    
    const exactMatches = {
        'название тт': 'name',
        'регион': 'region', 
        'адрес': 'address',
        'статус тт': 'status',
        'статус': 'status',
        'менеджер фио': 'manager',
        'менеджер': 'manager',
        'подрядчик фио': 'contractor',
        'подрядчик': 'contractor'
    };
    
    headersLower.forEach((header, index) => {
        if (exactMatches[header]) {
            const field = exactMatches[header];
            if (indices[field] === -1) {
                indices[field] = index;
            }
        }
    });
    
    let nextIndex = 0;
    Object.keys(indices).forEach(key => {
        if (indices[key] === -1) {
            while (Object.values(indices).includes(nextIndex) && nextIndex < headers.length) {
                nextIndex++;
            }
            if (nextIndex < headers.length) {
                indices[key] = nextIndex;
                nextIndex++;
            }
        }
    });
    
    return indices;
}

// ========== БЫСТРОЕ ДОБАВЛЕНИЕ КООРДИНАТ ==========

async function addCoordinatesFast(points) {
    console.log('⚡ Быстрое добавление координат...');
    
    if (!geocodingSystem) {
        return points.map(point => {
            if (!point.lat || !point.lng) {
                const coords = getRandomCoordinate(point.address, point.region);
                return { ...point, ...coords, isMock: true };
            }
            return point;
        });
    }
    
    const updatedPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        if (point.lat && point.lng && !point.isMock) {
            updatedPoints.push(point);
            continue;
        }
        
        if (point.address) {
            const cached = geocodingSystem.getFromCache(point.originalAddress || point.address, point.region);
            
            if (cached) {
                point.lat = cached.lat;
                point.lng = cached.lng;
                point.geocodingSource = cached.source;
                point.isMock = !cached.isExact;
                point.cached = true;
                
                updatedPoints.push(point);
                continue;
            }
        }
        
        const approximate = geocodingSystem.getApproximateCoordinates(point.address, point.region);
        point.lat = approximate.lat;
        point.lng = approximate.lng;
        point.isMock = true;
        point.geocodingSource = 'approximate_initial';
        
        updatedPoints.push(point);
    }
    
    return updatedPoints;
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========

function showPointsOnMap() {
    console.log('Показываю точки на карте...');
    
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`Фильтровано точек: ${filteredPoints.length}`);
    
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        }
    });
    
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            filteredPoints
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        }
    }
    
    updateStatistics();
    updateGeocodingStats();
}

function createMarker(point) {
    let color = CONFIG.STATUS_COLORS.default;
    const status = point.status || '';
    const statusLower = status.toLowerCase();
    
    if (status === 'Активная' || statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
    } else if (status === 'На паузе' || statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
    } else if (status === 'Закрыта' || statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (status === 'План' || statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    let accuracyIcon = '';
    if (point.isMock) {
        accuracyIcon = '<div style="position: absolute; top: -2px; right: -2px; width: 10px; height: 10px; background: #f39c12; border-radius: 50%; border: 2px solid white;"></div>';
    }
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
                <div style="
                    background: ${color};
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 12px;
                ">
                    ${point.name ? point.name.charAt(0).toUpperCase() : 'Т'}
                </div>
                ${accuracyIcon}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        pointId: point.id,
        isMock: point.isMock || false
    });
    
    marker.bindPopup(createPopupContent(point));
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || CONFIG.STATUS_COLORS.default;
    
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.replace(/"/g, '');
        displayAddress = displayAddress.trim();
    }
    
    let accuracyInfo = '';
    if (point.isMock) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        `;
    } else if (point.geocodingSource) {
        const sourceName = point.geocodingSource === 'yandex' ? 'Яндекс Карты' : 
                          point.geocodingSource === 'nominatim' ? 'OpenStreetMap' : 
                          point.geocodingSource === 'overpass' ? 'Overpass API' : 
                          point.geocodingSource === 'approximate' ? 'Приблизительные' : 
                          point.geocodingSource;
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #2ecc71; color: white; border-radius: 3px; font-size: 11px;">
                <i class="fas fa-check-circle"></i> Точные координаты (${sourceName})
            </div>
        `;
    }
    
    return `
        <div style="min-width: 250px; max-width: 300px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Без названия'}
            </h4>
            
            <div style="margin-bottom: 10px;">
                <strong>Статус:</strong> 
                <span style="color: ${color}; font-weight: 500;">${point.status || 'Не указан'}</span>
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${displayAddress}</span>
                </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
                ${point.region ? `
                    <div>
                        <strong>Регион:</strong><br>
                        ${point.region}
                    </div>
                ` : ''}
                
                ${point.manager ? `
                    <div>
                        <strong>Менеджер:</strong><br>
                        ${point.manager}
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <strong>Подрядчик:</strong><br>
                        ${point.contractor}
                    </div>
                ` : ''}
            </div>
            
            ${point.lat && point.lng ? `
                <div style="margin-top: 10px; font-size: 11px; color: #7f8c8d;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </div>
            ` : ''}
            
            ${accuracyInfo}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========

function updateFilters() {
    console.log('Обновляю фильтры...');
    
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project) filters.projects.add(point.project);
        if (point.region) filters.regions.add(point.region);
        if (point.status) filters.statuses.add(point.status);
        if (point.manager) filters.managers.add(point.manager);
    });
    
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
}

function fillFilter(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    const selected = Array.from(select.selectedOptions).map(opt => opt.value);
    select.innerHTML = '<option value="">Все</option>';
    
    options.forEach(option => {
        if (option && option.trim() !== '') {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            
            if (selected.includes(option)) {
                opt.selected = true;
            }
            
            select.appendChild(opt);
        }
    });
}

function applyFilters() {
    console.log('Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры...');
    
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.selectedIndex = 0;
    });
    
    activeFilters = {
        projects: [],
        regions: [],
        statuses: [],
        managers: []
    };
    
    showPointsOnMap();
    showNotification('Фильтры сброшены', 'success');
}

function getSelectedValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    
    return Array.from(select.selectedOptions)
        .map(opt => opt.value)
        .filter(val => val !== '');
}

function filterPoints() {
    const filtered = allPoints.filter(point => {
        const filters = [
            { key: 'project', value: point.project, active: activeFilters.projects },
            { key: 'region', value: point.region, active: activeFilters.regions },
            { key: 'status', value: point.status, active: activeFilters.statuses },
            { key: 'manager', value: point.manager, active: activeFilters.managers }
        ];
        
        for (const filter of filters) {
            if (filter.active.length > 0) {
                if (!filter.value || !filter.active.includes(filter.value)) {
                    return false;
                }
            }
        }
        
        return true;
    });
    
    return filtered;
}

// ========== ПОИСК ==========

function searchPoints() {
    const searchInput = document.getElementById('search');
    if (!searchInput) return;
    
    const query = searchInput.value.trim().toLowerCase();
    
    if (!query) {
        showNotification('Введите текст для поиска', 'info');
        return;
    }
    
    console.log(`Поиск: "${query}"`);
    
    const results = allPoints.filter(point => {
        return (
            (point.name && point.name.toLowerCase().includes(query)) ||
            (point.address && point.address.toLowerCase().includes(query)) ||
            (point.region && point.region.toLowerCase().includes(query)) ||
            (point.manager && point.manager.toLowerCase().includes(query))
        );
    });
    
    console.log(`Найдено результатов: ${results.length}`);
    
    if (results.length === 0) {
        showNotification('Ничего не найдено', 'info');
        return;
    }
    
    markerCluster.clearLayers();
    
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    if (results.length > 0 && results.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            results
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
    
    showNotification(`Найдено ${results.length} точек`, 'success');
}

// ========== ИНФОРМАЦИЯ О ТОЧКЕ ==========

function showPointDetails(point) {
    const container = document.getElementById('point-details');
    const infoSection = document.getElementById('point-info');
    
    if (!container || !infoSection) return;
    
    let color = CONFIG.STATUS_COLORS.default;
    const status = point.status || '';
    
    if (status === 'Активная') {
        color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
    } else if (status === 'На паузе') {
        color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 5px;">${point.name || 'Без названия'}</h5>
            ${point.status ? `
                <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                    ${point.status}
                </span>
            ` : ''}
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
            ${point.address ? `
                <p style="margin-bottom: 8px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address.substring(0, 100)}${point.address.length > 100 ? '...' : ''}</span>
                </p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p style="margin: 0;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
            ${point.region ? `
                <div>
                    <strong>Регион:</strong><br>
                    ${point.region}
                </div>
            ` : ''}
            
            ${point.manager ? `
                <div>
                    <strong>Менеджер:</strong><br>
                    ${point.manager}
                </div>
            ` : ''}
            
            ${point.contractor ? `
                <div>
                    <strong>Подрядчик:</strong><br>
                    ${point.contractor}
                </div>
            ` : ''}
            
            ${point.geocodingSource ? `
                <div>
                    <strong>Источник:</strong><br>
                    ${point.geocodingSource}
                </div>
            ` : ''}
        </div>
        
        ${point.isMock ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
}

// ========== СТАТИСТИКА ==========

function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const approximatePoints = filteredPoints.filter(p => p.isMock).length;
    
    const totalPointsElement = document.getElementById('total-points');
    const shownPointsElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    
    if (totalPointsElement) totalPointsElement.textContent = allPoints.length;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
}

function updateGeocodingStats() {
    if (!geocodingSystem) return;
    
    const totalPoints = allPoints.length;
    const exactCoords = allPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const mockCoords = allPoints.filter(p => p.isMock).length;
    
    const statsElement = document.getElementById('geocoding-stats');
    if (!statsElement) return;
    
    const stats = geocodingSystem.stats;
    
    statsElement.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px;">
            <div style="font-size: 12px; color: #95a5a6; margin-bottom: 5px;">
                <i class="fas fa-map-marker-alt"></i> Статистика координат:
            </div>
            <div style="display: flex; gap: 15px; font-size: 11px;">
                <div>
                    <span style="color: #2ecc71;">●</span> Точные: ${exactCoords}
                </div>
                <div>
                    <span style="color: #f39c12;">●</span> Приблизительные: ${mockCoords}
                </div>
                <div>
                    <span style="color: #e74c3c;">●</span> Без координат: ${totalPoints - exactCoords - mockCoords}
                </div>
            </div>
            <div style="margin-top: 8px; font-size: 10px; color: #7f8c8d;">
                <div>Кэш: ${stats.cached}</div>
                <div>Яндекс: ${stats.yandex} | OSM: ${stats.nominatim}</div>
            </div>
        </div>
    `;
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    let legendHTML = '';
    const statuses = new Set();
    
    allPoints.forEach(point => {
        if (point.status) statuses.add(point.status);
    });
    
    ['Активная', 'На паузе', 'Закрыта', 'План'].forEach(status => {
        if (!statuses.has(status)) statuses.add(status);
    });
    
    Array.from(statuses).sort().forEach(status => {
        let color = CONFIG.STATUS_COLORS[status] || CONFIG.STATUS_COLORS.default;
        
        legendHTML += `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: ${color}; border: 2px solid white;"></div>
                <span style="font-size: 12px;">${status}</span>
            </div>
        `;
    });
    
    container.innerHTML = legendHTML;
}

// ========== АВТООБНОВЛЕНИЕ ==========

function setupAutoUpdate() {
    if (CONFIG.UPDATE?.auto) {
        updateInterval = setInterval(loadData, CONFIG.UPDATE.interval);
        console.log('Автообновление настроено');
    }
}

// ========== ДЕМО-ДАННЫЕ ==========

function showDemoData() {
    console.log('Показываем демо-данные...');
    
    allPoints = [
        {
            id: 'demo_1',
            name: 'Магнит №123',
            region: 'Москва',
            address: 'ул. Тверская, д. 1',
            status: 'Активная',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.7570,
            lng: 37.6145,
            isMock: false,
            geocodingSource: 'demo'
        },
        {
            id: 'demo_2',
            name: 'Магнит №124',
            region: 'Московская обл.',
            address: 'г. Химки, ул. Ленина, 25',
            status: 'Активная',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.8890,
            lng: 37.4450,
            isMock: false,
            geocodingSource: 'demo'
        },
        {
            id: 'demo_3',
            name: 'Басенджи',
            region: 'Алтайский край',
            address: 'Алтайский край, Мамонтово (с), ул. Партизанская, 158',
            status: 'Активная',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            lat: 53.3481 + (Math.random() - 0.5) * 0.5,
            lng: 83.7794 + (Math.random() - 0.5) * 1.0,
            isMock: true,
            geocodingSource: 'approximate'
        }
    ];
    
    updateFilters();
    updateStatistics();
    updateLegend();
    updateGeocodingStats();
    showPointsOnMap();
    
    updateStatus('Демо-данные загружены');
    showNotification('Используются демо-данные', 'warning');
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getRandomCoordinate(address, region = '') {
    if (geocodingSystem) {
        return geocodingSystem.getApproximateCoordinates(address, region);
    }
    
    const randomLat = 55.7558 + (Math.random() - 0.5) * 2.0;
    const randomLng = 37.6173 + (Math.random() - 0.5) * 4.0;
    
    return {
        lat: randomLat,
        lng: randomLng,
        source: 'random',
        isExact: false,
        isMock: true
    };
}

// ========== УПРАВЛЕНИЕ ГЕОКОДИРОВАНИЕМ ==========

function startManualGeocoding() {
    if (!geocodingSystem) {
        showNotification('Система геокодирования не инициализирована', 'warning');
        return;
    }
    
    const pointsToGeocode = allPoints.filter(p => 
        p.address && (p.isMock || !p.lat || !p.lng)
    );
    
    if (pointsToGeocode.length === 0) {
        showNotification('Нет точек для уточнения координат', 'info');
        return;
    }
    
    showNotification(`Уточнение координат для ${pointsToGeocode.length} точек...`, 'info');
    
    pointsToGeocode.forEach(point => {
        geocodingSystem.addToQueue(point);
    });
    
    if (!geocodingSystem.processing) {
        geocodingSystem.processQueue();
    }
}

function clearGeocodingCache() {
    if (confirm('Очистить кэш геокодирования?')) {
        if (geocodingSystem) {
            geocodingSystem.clearCache();
        }
        localStorage.removeItem('geocoding_cache');
        showNotification('Кэш геокодирования очищен', 'success');
    }
}

function showGeocodingStats() {
    if (!geocodingSystem) {
        showNotification('Система геокодирования не инициализирована', 'error');
        return;
    }
    
    const stats = geocodingSystem.stats;
    const message = `
        <div style="text-align: left;">
            <h4>📊 Статистика геокодирования</h4>
            <p><strong>Всего запросов:</strong> ${stats.total}</p>
            <p><strong>Из кэша:</strong> ${stats.cached}</p>
            <p><strong>Яндекс нашел:</strong> ${stats.yandex}</p>
            <p><strong>OSM нашел:</strong> ${stats.nominatim}</p>
            <p><strong>Overpass нашел:</strong> ${stats.overpass}</p>
            <p><strong>Приблизительные:</strong> ${stats.approximate}</p>
            <p><strong>Не найдено:</strong> ${stats.failed}</p>
            <p><strong>В очереди:</strong> ${geocodingSystem.queue.length} задач</p>
            <p><strong>Размер кэша:</strong> ${geocodingSystem.cache.size} записей</p>
        </div>
    `;
    
    showModal('Статистика геокодирования', message);
}

// ========== ИНДИКАТОР ГЕОКОДИРОВАНИЯ ==========

function updateGeocodingIndicator(active, queueSize = 0) {
    const indicator = document.getElementById('geocoding-indicator');
    const textElement = document.getElementById('geocoding-indicator-text');
    
    if (!indicator || !textElement) return;
    
    if (active || queueSize > 0) {
        indicator.style.display = 'flex';
        if (active) {
            textElement.textContent = `Геокодирование... (${queueSize} в очереди)`;
        } else {
            textElement.textContent = `В очереди: ${queueSize}`;
        }
    } else {
        indicator.style.display = 'none';
    }
}

// Экспортируем функции
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.startManualGeocoding = startManualGeocoding;
window.clearGeocodingCache = clearGeocodingCache;
window.showGeocodingStats = showGeocodingStats;
window.updateGeocodingIndicator = updateGeocodingIndicator;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initApp);


