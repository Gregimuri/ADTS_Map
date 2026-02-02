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
            cached: 0,
            nominatim: 0,
            overpass: 0,
            failed: 0,
            approximate: 0
        };
        this.loadCache();
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
    
    normalizeRussianAddress(address) {
        if (!address) return '';
        
        console.log(`📝 Исходный адрес: ${address}`);
        
        // Удаляем почтовые индексы
        let normalized = address.toString().trim();
        normalized = normalized.replace(/^\d{6},?\s*/, '');
        normalized = normalized.replace(/,\s*\d{6}$/, '');
        
        // Удаляем лишние слова в скобках (кроме регионов)
        normalized = normalized.replace(/\([^)]+\)/g, (match) => {
            // Оставляем только скобки с названиями населенных пунктов
            const content = match.replace(/[()]/g, '');
            if (content.toLowerCase().includes('нас') || 
                content.toLowerCase().includes('пункт') ||
                content.toLowerCase().includes('с') ||
                content.toLowerCase().includes('рп') ||
                content.toLowerCase().includes('пгт') ||
                content.toLowerCase().includes('д')) {
                return content.trim();
            }
            return '';
        });
        
        // Удаляем лишние слова
        const stopWords = [
            'торговая точка', 'торг\\s*точка', 'тт', 'магазин',
            'здание', 'помещ[ение]*', 'пом\\.?', 'влд\\.?\\s*\\d+',
            'владение\\s*\\d+', 'влад\\.?\\s*\\d+', 'корп\\.?\\s*\\d+',
            'строение\\s*\\d+', 'жилой комплекс', 'жк', 'микрорайон', 'мкр\\.?',
            'населенный пункт', 'нас\\.?\\s*пункт', 'насел[ённый]*\\s*пункт',
            'литер.*', 'помещ.*', 'квартал.*', 'стр\\.?', 'корп\\.?',
            'пом\\.?\\s*\\w+', 'тер\\.?', 'территория', 'уч[аст]*к.*',
            'земельный участок', 'з/у', 'ж/д', 'производственных территорий'
        ];
        
        stopWords.forEach(pattern => {
            const regex = new RegExp(pattern, 'gi');
            normalized = normalized.replace(regex, '');
        });
        
        // Нормализуем сокращения
        const replacements = {
            'республика': '', 'область': '', 'край': '',
            'город': 'г', 'поселок': 'п', 'село': 'с', 'деревня': 'д',
            'улица': 'ул', 'проспект': 'пр-кт', 'переулок': 'пер',
            'шоссе': 'ш', 'проезд': 'пр-д', 'площадь': 'пл',
            'поселок городского типа': 'пгт', 'рабочий поселок': 'рп',
            'район': '', 'микрорайон': 'мкр', 'бульвар': 'б-р',
            'проспект': 'пр-кт', 'аллея': 'аллея', 'набережная': 'наб',
            'станция': 'ст', 'станица': 'ст-ца', 'хутор': 'х'
        };
        
        Object.entries(replacements).forEach(([full, short]) => {
            const regex = new RegExp(`\\b${full}\\b`, 'gi');
            normalized = normalized.replace(regex, short);
        });
        
        // Упрощаем формат: Регион, Город, Улица, Дом
        const parts = normalized.split(',').map(p => p.trim()).filter(p => p.length > 0);
        const simplifiedParts = [];
        
        // Ищем регион (область, край, республика)
        let regionFound = false;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if ((part.toLowerCase().includes('обл') || 
                 part.toLowerCase().includes('край') ||
                 part.toLowerCase().includes('респ')) && !regionFound) {
                simplifiedParts.push(part);
                regionFound = true;
                continue;
            }
            
            // Ищем населенный пункт (г, пгт, с, д, п, рп)
            if (part.match(/^(г\.|пгт\.|с\.|д\.|п\.|рп\.|ст-ца\.|х\.)/i) && simplifiedParts.length < 3) {
                simplifiedParts.push(part);
                continue;
            }
            
            // Ищем улицу
            if (part.match(/^(ул\.|пр-кт\.|пер\.|ш\.|пр-д\.|пл\.|б-р\.|наб\.|аллея)/i) && simplifiedParts.length < 4) {
                simplifiedParts.push(part);
                continue;
            }
            
            // Ищем номер дома (содержит цифры)
            if (/\d/.test(part) && simplifiedParts.length < 5) {
                // Извлекаем только номер дома и литеры
                const houseMatch = part.match(/(\d+[а-яa-z]?(?:\/\d+[а-яa-z]?)?)/i);
                if (houseMatch && houseMatch[1]) {
                    simplifiedParts.push(houseMatch[1]);
                }
                continue;
            }
        }
        
        // Если частей больше 4, берем только первые 4
        if (simplifiedParts.length > 4) {
            simplifiedParts.length = 4;
        }
        
        normalized = simplifiedParts.join(', ');
        
        // Очистка и нормализация формата
        normalized = normalized.replace(/,\s*,/g, ',');
        normalized = normalized.replace(/\s+,\s*/g, ', ');
        normalized = normalized.replace(/\s+/g, ' ').trim();
        normalized = normalized.replace(/\s*\/\s*/g, '/');
        
        // Приводим к правильному регистру
        normalized = normalized.split(', ').map(part => {
            return part.split(' ').map(word => {
                if (word.includes('-')) {
                    return word.split('-').map(part => 
                        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
                    ).join('-');
                }
                if (word.includes('.')) {
                    const parts = word.split('.');
                    return parts.map((p, i) => 
                        i === 0 ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase()
                    ).join('.');
                }
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }).join(' ');
        }).join(', ');
        
        console.log(`📝 Нормализованный адрес: ${normalized}`);
        return normalized.trim();
    }
    
    getCacheKey(address) {
        const normalized = this.normalizeRussianAddress(address).toLowerCase();
        return btoa(encodeURIComponent(normalized)).replace(/[^a-zA-Z0-9]/g, '');
    }
    
    getFromCache(address) {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        const cacheKey = this.getCacheKey(address);
        const cached = this.cache.get(cacheKey);
        
        if (cached) {
            const cacheDays = CONFIG.GEOCODING.cacheDays || 30;
            const maxAge = cacheDays * 24 * 60 * 60 * 1000;
            
            if (Date.now() - cached.timestamp < maxAge) {
                this.stats.cached++;
                return {
                    lat: cached.lat,
                    lng: cached.lng,
                    source: cached.source,
                    isExact: cached.isExact,
                    normalized: cached.normalized
                };
            } else {
                this.cache.delete(cacheKey);
            }
        }
        
        return null;
    }
    
    saveToCache(address, lat, lng, source = 'unknown', isExact = true) {
        if (!CONFIG.GEOCODING?.enabled) return;
        
        const cacheKey = this.getCacheKey(address);
        const normalized = this.normalizeRussianAddress(address);
        
        this.cache.set(cacheKey, {
            lat: lat,
            lng: lng,
            source: source,
            isExact: isExact,
            normalized: normalized,
            address: address,
            timestamp: Date.now()
        });
        
        if (this.cache.size % 10 === 0) {
            this.saveCache();
        }
    }
    
    async geocodeNominatim(address) {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            const normalized = this.normalizeRussianAddress(address);
            
            if (!normalized || normalized.length < 3) {
                return null;
            }
            
            const cached = this.getFromCache(address);
            if (cached) {
                return cached;
            }
            
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.nominatim || 1000));
            
            // Разбиваем адрес на части для разных вариантов поиска
            const parts = normalized.split(', ').filter(p => p.trim());
            const queries = [];
            
            // Вариант 1: Полный адрес
            if (normalized.length > 10) {
                queries.push(normalized);
            }
            
            // Вариант 2: Город + Улица + Дом
            if (parts.length >= 3) {
                const settlementIndex = parts.findIndex(p => p.match(/^(г\.|пгт\.|с\.|д\.|п\.)/i));
                const streetIndex = parts.findIndex(p => p.match(/^(ул\.|пр-кт\.|пер\.|ш\.)/i));
                const houseIndex = parts.findIndex(p => /\d/.test(p));
                
                if (settlementIndex !== -1 && streetIndex !== -1 && houseIndex !== -1) {
                    queries.push([parts[settlementIndex], parts[streetIndex], parts[houseIndex]].join(', '));
                }
            }
            
            // Вариант 3: Город + Улица
            if (parts.length >= 2) {
                const settlementIndex = parts.findIndex(p => p.match(/^(г\.|пгт\.|с\.|д\.|п\.)/i));
                const streetIndex = parts.findIndex(p => p.match(/^(ул\.|пр-кт\.|пер\.|ш\.)/i));
                
                if (settlementIndex !== -1 && streetIndex !== -1) {
                    queries.push([parts[settlementIndex], parts[streetIndex]].join(', '));
                }
            }
            
            // Вариант 4: Только город
            const settlementPart = parts.find(p => p.match(/^(г\.|пгт\.)/i));
            if (settlementPart) {
                queries.push(settlementPart);
            }
            
            console.log(`🌍 OSM запросы для "${normalized}":`, queries);
            
            for (const query of queries.slice(0, 3)) { // Ограничим 3 запросами
                try {
                    console.log(`🌍 OSM запрос: ${query}`);
                    const result = await this.queryNominatim(query);
                    
                    if (result) {
                        console.log(`✅ OSM нашел: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`);
                        
                        this.stats.nominatim++;
                        const geocodeResult = {
                            lat: result.lat,
                            lng: result.lng,
                            source: 'nominatim',
                            isExact: true,
                            normalized: normalized
                        };
                        
                        this.saveToCache(address, result.lat, result.lng, 'nominatim', true);
                        return geocodeResult;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (e) {
                    console.warn(`Ошибка OSM запроса:`, e.message);
                    continue;
                }
            }
            
            console.log(`❌ OSM не нашел: ${normalized.substring(0, 50)}...`);
            return null;
            
        } catch (error) {
            console.warn('❌ Ошибка OSM:', error.message);
            return null;
        }
    }
    
    async queryNominatim(query) {
        const encoded = encodeURIComponent(query);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1&countrycodes=ru&accept-language=ru&addressdetails=1`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': CONFIG.GEOCODING.osmUserAgent || 'TTMapApp/1.0',
                    'Accept': 'application/json',
                    'Referer': 'https://tt-map-app.example.com'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data && data.length > 0) {
                    const item = data[0];
                    const lat = parseFloat(item.lat);
                    const lon = parseFloat(item.lon);
                    
                    console.log(`✅ OSM результат: ${item.type || 'unknown'} (важность: ${item.importance || 0})`);
                    console.log(`📍 Найден: ${item.display_name?.substring(0, 80)}...`);
                    
                    return {
                        lat: lat,
                        lng: lon,
                        displayName: item.display_name || ''
                    };
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('⏰ Таймаут OSM запроса');
            }
            throw error;
        }
        
        return null;
    }
    
    async geocodeOverpassAPI(address) {
        if (!CONFIG.GEOCODING?.alternativeServices?.osmOverpass) {
            return null;
        }
        
        try {
            const settlementName = this.extractSettlementName(address);
            if (!settlementName) return null;
            
            console.log(`🗺️  Overpass ищет: ${settlementName}`);
            
            const overpassQuery = `
                [out:json][timeout:25];
                area["ISO3166-1"="RU"]->.russia;
                (
                    node["place"~"city|town|village|hamlet"]["name"~"${settlementName}",i](area.russia);
                    way["place"~"city|town|village|hamlet"]["name"~"${settlementName}",i](area.russia);
                );
                out center;
            `;
            
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.elements && data.elements.length > 0) {
                    const element = data.elements[0];
                    const lat = element.lat || element.center?.lat;
                    const lon = element.lon || element.center?.lon;
                    
                    if (lat && lon) {
                        console.log(`✅ Overpass нашел: ${settlementName} (${lat.toFixed(6)}, ${lon.toFixed(6)})`);
                        
                        this.stats.overpass++;
                        
                        return {
                            lat: lat,
                            lng: lon,
                            source: 'overpass',
                            isExact: false,
                            settlement: settlementName
                        };
                    }
                }
            }
            
        } catch (error) {
            console.warn('⚠️ Ошибка Overpass:', error.message);
        }
        
        return null;
    }
    
    extractSettlementName(address) {
        if (!address) return null;
        
        const normalized = this.normalizeRussianAddress(address);
        const parts = normalized.split(', ');
        
        // Ищем населенный пункт
        for (const part of parts) {
            if (part.match(/^(г\.|пгт\.|с\.|д\.|п\.|рп\.|ст-ца\.)/i)) {
                // Извлекаем название после сокращения
                const name = part.replace(/^(г\.|пгт\.|с\.|д\.|п\.|рп\.|ст-ца\.)\s*/i, '');
                if (name.length > 1) return name;
            }
        }
        
        // Если не нашли сокращение, берем первую часть без цифр
        for (const part of parts) {
            if (!/\d/.test(part) && part.length > 2) {
                return part;
            }
        }
        
        return null;
    }
    
    async geocode(address, region = '', pointId = null) {
        if (!CONFIG.GEOCODING?.enabled || !address) {
            return this.getApproximateCoordinates(address, region);
        }
        
        this.stats.total++;
        
        console.log(`🔍 Геокодирование: ${address.substring(0, 60)}...`);
        
        const cached = this.getFromCache(address);
        if (cached) {
            return cached;
        }
        
        const normalized = this.normalizeRussianAddress(address);
        
        // Сначала OSM, потом Overpass
        const serviceOrder = [
            { name: 'nominatim', func: () => this.geocodeNominatim(address) },
            { name: 'overpass', func: () => this.geocodeOverpassAPI(address) }
        ];
        
        let result = null;
        let usedService = 'none';
        
        for (const service of serviceOrder) {
            try {
                console.log(`🔄 Пробуем ${service.name}...`);
                result = await service.func();
                
                if (result) {
                    usedService = service.name;
                    break;
                }
                
            } catch (error) {
                console.warn(`⚠️ ${service.name} ошибка:`, error.message);
                continue;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (result && result.isExact !== false) {
            this.saveToCache(address, result.lat, result.lng, usedService, true);
            
            if (pointId) {
                this.updatePointAndMarker(pointId, result.lat, result.lng, usedService);
            }
            
            return result;
        }
        
        if (result && result.isExact === false) {
            this.stats.approximate++;
            this.saveToCache(address, result.lat, result.lng, usedService, false);
            return result;
        }
        
        this.stats.failed++;
        const approximate = this.getApproximateCoordinates(address, region);
        this.saveToCache(address, approximate.lat, approximate.lng, 'approximate', false);
        
        return approximate;
    }
    
    getApproximateCoordinates(address, region = '') {
        // Основные крупные города России
        const cityCoords = {
            'москва': { lat: 55.7558, lng: 37.6173 },
            'санкт-петербург': { lat: 59.9343, lng: 30.3351 },
            'новосибирск': { lat: 55.0084, lng: 82.9357 },
            'екатеринбург': { lat: 56.8389, lng: 60.6057 },
            'казань': { lat: 55.8304, lng: 49.0661 },
            'нижний новгород': { lat: 56.2965, lng: 43.9361 },
            'челябинск': { lat: 55.1644, lng: 61.4368 },
            'самара': { lat: 53.1959, lng: 50.1002 },
            'омск': { lat: 54.9885, lng: 73.3242 },
            'ростов-на-дону': { lat: 47.2224, lng: 39.7189 },
            'уфа': { lat: 54.7388, lng: 55.9721 },
            'красноярск': { lat: 56.0153, lng: 92.8932 },
            'пермь': { lat: 58.0048, lng: 56.2377 },
            'воронеж': { lat: 51.6755, lng: 39.2089 },
            'волгоград': { lat: 48.7071, lng: 44.5169 }
        };
        
        const searchText = (address || '').toLowerCase();
        
        // Ищем город в адресе
        for (const [city, coords] of Object.entries(cityCoords)) {
            if (searchText.includes(city)) {
                console.log(`📍 Приблизительные координаты для города ${city}`);
                
                // Добавляем небольшое случайное смещение
                const randomLat = coords.lat + (Math.random() - 0.5) * 0.05;
                const randomLng = coords.lng + (Math.random() - 0.5) * 0.1;
                
                this.stats.approximate++;
                
                return {
                    lat: randomLat,
                    lng: randomLng,
                    source: 'approximate',
                    isExact: false,
                    isMock: true,
                    normalized: this.normalizeRussianAddress(address)
                };
            }
        }
        
        // По умолчанию возвращаем центр России с небольшим смещением
        const randomLat = 55.7558 + (Math.random() - 0.5) * 2.0;
        const randomLng = 37.6173 + (Math.random() - 0.5) * 4.0;
        
        this.stats.approximate++;
        
        return {
            lat: randomLat,
            lng: randomLng,
            source: 'approximate',
            isExact: false,
            isMock: true,
            normalized: this.normalizeRussianAddress(address)
        };
    }
    
    updatePointAndMarker(pointId, lat, lng, source) {
        const pointIndex = allPoints.findIndex(p => p.id === pointId);
        if (pointIndex === -1) return;
        
        const point = allPoints[pointIndex];
        const oldLat = point.lat;
        const oldLng = point.lng;
        
        point.lat = lat;
        point.lng = lng;
        point.isMock = false;
        point.geocodingSource = source;
        point.geocodedAt = new Date().toISOString();
        
        console.log(`🔄 Обновление точки: ${oldLat?.toFixed(6)},${oldLng?.toFixed(6)} → ${lat.toFixed(6)},${lng.toFixed(6)}`);
        
        if (markersMap.has(pointId)) {
            const marker = markersMap.get(pointId);
            marker.setLatLng([lat, lng]);
            marker.bindPopup(createPopupContent(point));
            
            const markerElement = marker.getElement();
            if (markerElement) {
                markerElement.classList.add('marker-updating');
                setTimeout(() => {
                    if (markerElement) markerElement.classList.remove('marker-updating');
                }, 1000);
            }
        }
        
        updateStatistics();
        updateGeocodingStats();
        
        showNotification(`Координаты уточнены: ${point.name?.substring(0, 20)}...`, 'success', 3000);
    }
    
    addToQueue(point) {
        if (!CONFIG.GEOCODING?.enabled || 
            !point.address || 
            point.geocodingQueued || 
            (point.lat && point.lng && !point.isMock)) {
            return;
        }
        
        point.geocodingQueued = true;
        
        this.queue.push({
            pointId: point.id,
            address: point.address,
            region: point.region,
            priority: point.isMock ? 1 : 0,
            retryCount: 0,
            timestamp: Date.now()
        });
        
        console.log(`📋 В очередь: ${point.address?.substring(0, 50)}...`);
    }
    
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        try {
            this.queue.sort((a, b) => b.priority - a.priority);
            const batch = this.queue.splice(0, Math.min(CONFIG.GEOCODING.maxConcurrent || 1, this.queue.length));
            
            console.log(`⚙️  Обработка: ${batch.length} задач`);
            
            updateGeocodingIndicator(true, this.queue.length);
            
            for (const task of batch) {
                try {
                    const result = await this.geocode(task.address, task.region, task.pointId);
                    
                    if (!result || !result.isExact) {
                        task.retryCount++;
                        task.priority = -1;
                        
                        if (task.retryCount <= (CONFIG.GEOCODING.maxRetries || 3)) {
                            this.queue.push(task);
                        }
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    
                } catch (error) {
                    console.warn('❌ Ошибка в очереди:', error.message);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка обработки очереди:', error);
        } finally {
            this.processing = false;
            updateGeocodingIndicator(false, this.queue.length);
            
            if (this.queue.length > 0) {
                setTimeout(() => this.processQueue(), 5000);
            } else {
                console.log('📭 Очередь пуста');
                showNotification('Геокодирование завершено', 'success', 3000);
            }
        }
    }
    
    startBackgroundGeocoding() {
        if (!CONFIG.GEOCODING?.enabled) return;
        
        const pointsToGeocode = allPoints.filter(p => 
            p.address && (p.isMock || !p.lat || !p.lng)
        );
        
        console.log(`🎯 Фоновое геокодирование: ${pointsToGeocode.length} точек`);
        
        pointsToGeocode.forEach(point => {
            this.addToQueue(point);
        });
        
        if (pointsToGeocode.length > 0 && !this.processing) {
            setTimeout(() => this.processQueue(), 3000);
        }
    }
    
    printStats() {
        console.log('📊 Статистика геокодирования:');
        console.log(`   Всего: ${this.stats.total}`);
        console.log(`   Кэш: ${this.stats.cached}`);
        console.log(`   OSM: ${this.stats.nominatim}`);
        console.log(`   Overpass: ${this.stats.overpass}`);
        console.log(`   Приблизительные: ${this.stats.approximate}`);
        console.log(`   Ошибки: ${this.stats.failed}`);
        console.log(`   Размер кэша: ${this.cache.size}`);
        console.log(`   Очередь: ${this.queue.length}`);
    }
    
    clearCache() {
        this.cache.clear();
        localStorage.removeItem('geocoding_cache');
        console.log('🧹 Кэш очищен');
        showNotification('Кэш геокодирования очищен', 'success');
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========

function initApp() {
    console.log('Инициализация приложения...');
    initMap();
    
    if (CONFIG.GEOCODING?.enabled) {
        geocodingSystem = new GeocodingSystem();
        console.log('🚀 Система геокодирования инициализирована (только OSM)');
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
        
        // Сохраняем оригинальный адрес
        point.originalAddress = point.address || '';
        
        // Нормализуем адрес через geocodingSystem если он инициализирован
        if (point.address && geocodingSystem) {
            point.address = geocodingSystem.normalizeRussianAddress(point.address);
            console.log(`📝 Нормализация адреса: ${point.originalAddress.substring(0, 60)}... → ${point.address.substring(0, 60)}...`);
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
            const cached = geocodingSystem.getFromCache(point.originalAddress || point.address);
            
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
        const sourceName = point.geocodingSource === 'nominatim' ? 'OpenStreetMap' : 
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
                <div>OSM: ${stats.nominatim}</div>
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

// ========== ЭКСПОРТ ФУНКЦИЙ ==========

window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.startManualGeocoding = startManualGeocoding;
window.clearGeocodingCache = clearGeocodingCache;
window.showGeocodingStats = showGeocodingStats;
window.updateGeocodingIndicator = updateGeocodingIndicator;

// Обновление статуса геокодирования
setInterval(() => {
    if (geocodingSystem) {
        const queueSize = geocodingSystem.queue.length;
        const isActive = geocodingSystem.processing;
        updateGeocodingIndicator(isActive, queueSize);
    }
}, 1000);
