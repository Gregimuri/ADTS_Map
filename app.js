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

// ========== СИСТЕМА ГЕОКОДИРОВАНИЯ ==========

class GeocodingSystem {
    constructor() {
        this.cache = new Map();
        this.queue = [];
        this.processing = false;
        this.stats = {
            total: 0,
            yandex: 0,
            nominatim: 0,
            cached: 0,
            failed: 0,
            approximate: 0
        };
        this.loadCache();
    }
    
    // Загрузка кэша из localStorage
    loadCache() {
        try {
            const cached = localStorage.getItem('geocoding_cache');
            if (cached) {
                const data = JSON.parse(cached);
                const cacheDays = CONFIG.GEOCODING?.cacheDays || 30;
                const maxAge = cacheDays * 24 * 60 * 60 * 1000;
                
                if (Date.now() - data.timestamp < maxAge) {
                    this.cache = new Map(Object.entries(data.cache));
                    console.log(`Загружен кэш геокодирования: ${this.cache.size} записей`);
                } else {
                    console.log('Кэш геокодирования устарел');
                    localStorage.removeItem('geocoding_cache');
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки кэша:', error);
        }
    }
    
    // Сохранение кэша в localStorage
    saveCache() {
        try {
            const cacheData = {
                cache: Object.fromEntries(this.cache),
                timestamp: Date.now()
            };
            localStorage.setItem('geocoding_cache', JSON.stringify(cacheData));
        } catch (error) {
            console.error('Ошибка сохранения кэша:', error);
        }
    }
    
    // НОРМАЛИЗАЦИЯ АДРЕСА ДЛЯ РОССИЙСКОГО ФОРМАТА
    normalizeRussianAddress(address, region = '') {
    if (!address) return '';
    
    let normalized = address.toString().trim();
    
    console.log(`🔍 Исходный адрес: ${normalized}`);
    
    // 1. Удаляем почтовый индекс
    normalized = normalized.replace(/^\d{6},?\s*/, '');
    normalized = normalized.replace(/,\s*\d{6}$/, '');
    
    // 2. Удаляем дублирование региона
    if (region) {
        const regionPattern = new RegExp(`^${region}\\s*[/,–-]\\s*`, 'i');
        normalized = normalized.replace(regionPattern, '');
        normalized = normalized.replace(new RegExp(`^${region},?\\s*`, 'i'), '');
    }
    
    // 3. Удаляем текст в скобках
    normalized = normalized.replace(/\s*\([^)]*\)/g, '');
    
    // 4. Удаляем специальные пометки
    const stopWords = [
        'нас. пункт', 'населенный пункт', 'нас.пункт', 'Нас.пункт',
        'торговая точка', 'торг точка', 'тт', 'магазин',
        'здание', 'помещение', 'пом.', 'владение', 'влад.',
        'корп.', 'стр.', 'строение', 'литер', 'лит.',
        'дом №', 'дом№', '№', 'зд.', 'помещ.', 'влд.'
    ];
    
    stopWords.forEach(word => {
        const regex = new RegExp(`\\s*${word}\\s*`, 'gi');
        normalized = normalized.replace(regex, ' ');
    });
    
    // 5. Упрощаем для Яндекса - только самое важное
    // Яндекс не любит длинные адреса с деталями
    
    // 6. Убираем "Россия" - Яндекс и так ищет в России
    normalized = normalized.replace(/,\s*Россия$/i, '');
    normalized = normalized.replace(/,\s*РФ$/i, '');
    
    // 7. Стандартизируем сокращения (упрощенная версия)
    const replacements = [
        ['улица', 'ул.'],
        ['проспект', 'пр-кт.'],
        ['переулок', 'пер.'],
        ['бульвар', 'б-р.'],
        ['шоссе', 'ш.'],
        ['площадь', 'пл.'],
        ['набережная', 'наб.'],
        ['село', 'с.'],
        ['деревня', 'д.'],
        ['поселок', 'п.'],
        ['посёлок', 'п.'],
        ['город', 'г.'],
        ['район', 'р-н'],
        ['область', 'обл.'],
        ['край', 'край'],
        ['республика', 'респ.']
    ];
    
    replacements.forEach(([from, to]) => {
        const regex = new RegExp(`\\b${from}\\b`, 'gi');
        normalized = normalized.replace(regex, to);
    });
    
    // 8. Убираем лишние пробелы и запятые
    normalized = normalized.replace(/\s+/g, ' ');
    normalized = normalized.replace(/,+/g, ',');
    normalized = normalized.replace(/\s*,\s*/g, ', ');
    normalized = normalized.trim();
    
    // 9. Убираем запятую в начале и конце
    normalized = normalized.replace(/^,\s*/, '');
    normalized = normalized.replace(/,\s*$/, '');
    
    // 10. Для Яндекса делаем адрес короче - оставляем только 2-3 ключевых элемента
    const parts = normalized.split(',').map(p => p.trim()).filter(p => p);
    
    if (parts.length > 3) {
        // Берем: город, улица, дом (если есть)
        const simplified = [];
        
        // Ищем город
        const cityIndex = parts.findIndex(p => p.match(/(г\.|с\.|п\.|пгт\.)/));
        if (cityIndex !== -1) {
            simplified.push(parts[cityIndex]);
        } else if (parts.length > 0) {
            simplified.push(parts[0]); // Первый элемент как город
        }
        
        // Ищем улицу
        const streetIndex = parts.findIndex(p => p.match(/(ул\.|пр-кт\.|пер\.|б-р\.)/));
        if (streetIndex !== -1) {
            simplified.push(parts[streetIndex]);
            
            // Ищем номер дома после улицы
            if (streetIndex + 1 < parts.length) {
                const nextPart = parts[streetIndex + 1];
                if (nextPart.match(/\d/)) {
                    simplified.push(nextPart);
                }
            }
        }
        
        if (simplified.length > 0) {
            normalized = simplified.join(', ');
        } else if (parts.length >= 2) {
            // Просто берем последние 2 части
            normalized = parts.slice(-2).join(', ');
        }
    }
    
    console.log(`✅ Нормализовано: ${normalized}`);
    return normalized;
}
    
    // Оригинальная функция нормализации (для обратной совместимости)
    normalizeAddress(address, region = '') {
        return this.normalizeRussianAddress(address, region);
    }
    
    // Генерация ключа для кэша
    getCacheKey(address, region = '') {
        const normalized = this.normalizeRussianAddress(address, region).toLowerCase();
        return btoa(encodeURIComponent(normalized)).replace(/[^a-zA-Z0-9]/g, '');
    }
    
    // Получение координат из кэша
    getFromCache(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        const cacheKey = this.getCacheKey(address, region);
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
    
    // Сохранение в кэш
    saveToCache(address, region = '', lat, lng, source = 'unknown', isExact = true) {
        if (!CONFIG.GEOCODING?.enabled) return;
        
        const cacheKey = this.getCacheKey(address, region);
        const normalized = this.normalizeRussianAddress(address, region);
        
        this.cache.set(cacheKey, {
            lat: lat,
            lng: lng,
            source: source,
            isExact: isExact,
            normalized: normalized,
            address: address,
            region: region,
            timestamp: Date.now()
        });
        
        // Периодически сохраняем
        if (this.cache.size % 10 === 0) {
            this.saveCache();
        }
    }
    
    // ГЕОКОДИРОВАНИЕ ЧЕРЕЗ ЯНДЕКС
    async geocodeYandex(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    try {
        // Упрощаем адрес
        let query = '';
        
        // Берем только город, улицу и номер дома
        const parts = address.split(',');
        if (parts.length >= 2) {
            // Берем последние 2-3 части
            query = parts.slice(-3).join(',').trim();
        } else {
            query = address;
        }
        
        // Убираем "Россия" и лишние детали
        query = query.replace(/,\s*Россия$/i, '')
                     .replace(/\([^)]*\)/g, '')
                     .replace(/\s+/g, ' ')
                     .trim();
        
        // Если слишком длинный, сокращаем
        if (query.length > 100) {
            const cityMatch = query.match(/(г\.|город)\s+[^,]+/i);
            const streetMatch = query.match(/(ул\.|улица)\s+[^,]+/i);
            const houseMatch = query.match(/\d+/);
            
            query = '';
            if (cityMatch) query += cityMatch[0] + ', ';
            if (streetMatch) query += streetMatch[0];
            if (houseMatch) query += ' ' + houseMatch[0];
        }
        
        if (!query || query.length < 3) {
            return null;
        }
        
        // Ждем
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const encoded = encodeURIComponent(query);
        const url = `https://geocode-maps.yandex.ru/1.x/?format=json&geocode=${encoded}&results=1`;
        
        console.log(`📍 Яндекс (фикс): ${query}`);
        
        const response = await fetch(url);
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.response?.GeoObjectCollection?.featureMember?.length > 0) {
                const pos = data.response.GeoObjectCollection.featureMember[0]
                    .GeoObject.Point.pos.split(' ');
                
                this.stats.yandex++;
                console.log(`✅ Яндекс нашел: ${pos[1]}, ${pos[0]}`);
                
                return {
                    lat: parseFloat(pos[1]),
                    lng: parseFloat(pos[0]),
                    source: 'yandex',
                    isExact: true,
                    normalized: query
                };
            }
        }
        
        return null;
        
    } catch (error) {
        console.warn('Ошибка Яндекс (фикс):', error);
        return null;
    }
}
    
    // ГЕОКОДИРОВАНИЕ ЧЕРЕЗ NOMINATIM (OpenStreetMap)
    async geocodeNominatim(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            const normalized = this.normalizeRussianAddress(address, region);
            
            // Ждем перед запросом
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.nominatim || 1000));
            
            const encoded = encodeURIComponent(normalized);
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1&countrycodes=ru&accept-language=ru`;
            
            console.log(`🌍 OSM: ${normalized.substring(0, 60)}...`);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'TTMapApp/1.0',
                    'Accept': 'application/json',
                    'Referer': 'https://tt-map.local/'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data && data.length > 0) {
                    const lat = parseFloat(data[0].lat);
                    const lon = parseFloat(data[0].lon);
                    
                    this.stats.nominatim++;
                    console.log(`✅ OSM нашел: ${lat}, ${lon}`);
                    
                    return {
                        lat: lat,
                        lng: lon,
                        source: 'nominatim',
                        isExact: true,
                        normalized: normalized
                    };
                }
            }
            
            console.log(`❌ OSM не нашел: ${normalized.substring(0, 50)}...`);
            return null;
            
        } catch (error) {
            console.warn('Ошибка геокодирования OSM:', error);
            return null;
        }
    }
    
    // ГЛАВНАЯ ФУНКЦИЯ ГЕОКОДИРОВАНИЯ
    async geocode(address, region = '', pointId = null) {
        if (!CONFIG.GEOCODING?.enabled || !address) {
            return this.getApproximateCoordinates(address, region);
        }
        
        this.stats.total++;
        
        // 1. Проверяем кэш
        const cached = this.getFromCache(address, region);
        if (cached) {
            console.log(`📦 Из кэша: ${address.substring(0, 50)}...`);
            return cached;
        }
        
        console.log(`🔍 Геокодирование: ${address.substring(0, 60)}...`);
        
        // 2. Нормализуем адрес
        const normalized = this.normalizeRussianAddress(address, region);
        console.log(`   Нормализовано: ${normalized.substring(0, 80)}...`);
        
        let result = null;
        
        // 3. Яндекс (первый приоритет)
        result = await this.geocodeYandex(address, region);
        
        // 4. Если Яндекс не нашел, пробуем Nominatim
        if (!result) {
            result = await this.geocodeNominatim(address, region);
        }
        
        // 5. Если нашли точные координаты, сохраняем в кэш
        if (result && result.isExact) {
            this.saveToCache(address, region, result.lat, result.lng, result.source, true);
            
            // Обновляем точку и маркер на карте
            if (pointId) {
                this.updatePointAndMarker(pointId, result.lat, result.lng, result.source);
            }
            
            return result;
        }
        
        // 6. Если не нашли, возвращаем приблизительные координаты
        this.stats.failed++;
        const approximate = this.getApproximateCoordinates(address, region);
        this.saveToCache(address, region, approximate.lat, approximate.lng, 'approximate', false);
        
        return approximate;
    }
    
    // Получение приблизительных координат
    getApproximateCoordinates(address, region = '') {
        const regionCoords = {
            'Москва': { lat: 55.7558, lng: 37.6173, radius: 0.05 },
            'Московская': { lat: 55.7558, lng: 37.6173, radius: 0.3 },
            'Санкт-Петербург': { lat: 59.9343, lng: 30.3351, radius: 0.05 },
            'Ленинградская': { lat: 59.9343, lng: 30.3351, radius: 0.3 },
            'Алтайский': { lat: 53.3481, lng: 83.7794, radius: 0.5 },
            'Алтайский край': { lat: 53.3481, lng: 83.7794, radius: 0.5 },
            'Архангельская': { lat: 64.5401, lng: 40.5433, radius: 0.5 },
            'Архангельская обл.': { lat: 64.5401, lng: 40.5433, radius: 0.5 },
            'Астраханская': { lat: 46.3497, lng: 48.0408, radius: 0.5 },
            'Вологодская': { lat: 59.2181, lng: 39.8886, radius: 0.5 },
            'Воронежская': { lat: 51.6608, lng: 39.2003, radius: 0.3 },
            'Екатеринбург': { lat: 56.8389, lng: 60.6057, radius: 0.05 },
            'Иркутская': { lat: 52.2864, lng: 104.2807, radius: 0.5 },
            'Казань': { lat: 55.7961, lng: 49.1064, radius: 0.05 },
            'Калининградская': { lat: 54.7104, lng: 20.4522, radius: 0.2 },
            'Кемеровская': { lat: 55.3547, lng: 86.0873, radius: 0.3 },
            'Краснодарский': { lat: 45.0355, lng: 38.9753, radius: 0.3 },
            'Красноярский': { lat: 56.0153, lng: 92.8932, radius: 0.5 },
            'Нижегородская': { lat: 56.2965, lng: 43.9361, radius: 0.3 },
            'Новосибирская': { lat: 55.0084, lng: 82.9357, radius: 0.3 },
            'Омская': { lat: 54.9893, lng: 73.3682, radius: 0.3 },
            'Оренбургская': { lat: 51.7682, lng: 55.0968, radius: 0.3 },
            'Пермский': { lat: 58.0105, lng: 56.2502, radius: 0.3 },
            'Ростовская': { lat: 47.2224, lng: 39.7189, radius: 0.3 },
            'Самарская': { lat: 53.1959, lng: 50.1002, radius: 0.3 },
            'Саратовская': { lat: 51.5924, lng: 45.9608, radius: 0.3 },
            'Свердловская': { lat: 56.8389, lng: 60.6057, radius: 0.3 },
            'Татарстан': { lat: 55.7961, lng: 49.1064, radius: 0.3 },
            'Тюменская': { lat: 57.1530, lng: 65.5343, radius: 0.3 },
            'Ульяновская': { lat: 54.3142, lng: 48.4031, radius: 0.3 },
            'Челябинская': { lat: 55.1644, lng: 61.4368, radius: 0.3 },
            'Ярославская': { lat: 57.6261, lng: 39.8845, radius: 0.3 },
            'default': { lat: 55.7558, lng: 37.6173, radius: 1.0 }
        };
        
        let baseLat = 55.7558;
        let baseLng = 37.6173;
        let radius = 1.0;
        
        // Ищем регион в адресе или переданном регионе
        const searchText = (region || address || '').toLowerCase();
        
        for (const [key, coords] of Object.entries(regionCoords)) {
            if (searchText.includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                radius = coords.radius;
                break;
            }
        }
        
        // Генерируем случайные координаты в радиусе
        const randomLat = baseLat + (Math.random() - 0.5) * radius;
        const randomLng = baseLng + (Math.random() - 0.5) * radius * 2;
        
        this.stats.approximate++;
        
        return {
            lat: randomLat,
            lng: randomLng,
            source: 'approximate',
            isExact: false,
            isMock: true,
            normalized: this.normalizeRussianAddress(address, region)
        };
    }
    
    // ОБНОВЛЕНИЕ ТОЧКИ И МАРКЕРА НА КАРТЕ
    updatePointAndMarker(pointId, lat, lng, source) {
        // Находим точку в массиве allPoints
        const pointIndex = allPoints.findIndex(p => p.id === pointId);
        if (pointIndex === -1) {
            console.warn(`Точка ${pointId} не найдена для обновления`);
            return;
        }
        
        const point = allPoints[pointIndex];
        
        // Сохраняем старые координаты для анимации
        const oldLat = point.lat;
        const oldLng = point.lng;
        
        // Обновляем координаты точки
        point.lat = lat;
        point.lng = lng;
        point.isMock = false;
        point.geocodingSource = source;
        point.geocodedAt = new Date().toISOString();
        
        console.log(`🔄 Обновление точки ${pointId}: ${oldLat},${oldLng} → ${lat},${lng}`);
        
        // Обновляем маркер на карте с анимацией
        this.updateMarkerWithAnimation(pointId, point, oldLat, oldLng, lat, lng);
        
        // Обновляем статистику
        updateStatistics();
        updateGeocodingStats();
        
        // Показываем уведомление
        showNotification(`Уточнены координаты: ${point.name?.substring(0, 20)}...`, 'success', 3000);
    }
    
    // ОБНОВЛЕНИЕ МАРКЕРА С АНИМАЦИЕЙ
    updateMarkerWithAnimation(pointId, point, oldLat, oldLng, newLat, newLng) {
        if (!markersMap.has(pointId)) {
            console.warn(`Маркер точки ${pointId} не найден на карте`);
            return;
        }
        
        const marker = markersMap.get(pointId);
        
        // Если маркер находится в кластере, удаляем его и добавляем заново
        if (markerCluster.hasLayer(marker)) {
            // Удаляем старый маркер из кластера
            markerCluster.removeLayer(marker);
            
            // Создаем новый маркер с обновленными координатами
            const newMarker = createMarker(point);
            
            // Добавляем анимацию перемещения
            this.animateMarkerMove(marker, newMarker, oldLat, oldLng, newLat, newLng);
            
            // Добавляем новый маркер в кластер
            markerCluster.addLayer(newMarker);
            
            // Обновляем ссылку в карте маркеров
            markersMap.set(pointId, newMarker);
        } else {
            // Если маркер не в кластере (например, при поиске)
            marker.setLatLng([newLat, newLng]);
            
            // Обновляем popup с новой информацией
            marker.bindPopup(createPopupContent(point));
            
            // Обновляем иконку (убираем индикатор приблизительных координат)
            const newIcon = createMarker(point).getIcon();
            marker.setIcon(newIcon);
        }
    }
    
    // АНИМАЦИЯ ПЕРЕМЕЩЕНИЯ МАРКЕРА
    animateMarkerMove(oldMarker, newMarker, fromLat, fromLng, toLat, toLng) {
        const steps = 20; // Количество шагов анимации
        const duration = 1000; // Длительность анимации в мс
        const stepTime = duration / steps;
        
        let step = 0;
        
        // Создаем временный маркер для анимации
        const tempIcon = L.divIcon({
            html: `
                <div style="
                    background: ${newMarker.options.icon.options.html.includes('#2ecc71') ? '#2ecc71' : '#3498db'};
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
                    <i class="fas fa-map-marker-alt"></i>
                </div>
            `,
            className: 'animated-marker',
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });
        
        const animatedMarker = L.marker([fromLat, fromLng], {
            icon: tempIcon,
            zIndexOffset: 1000
        }).addTo(map);
        
        // Анимация перемещения
        const animate = () => {
            if (step > steps) {
                // Удаляем анимированный маркер
                map.removeLayer(animatedMarker);
                return;
            }
            
            // Интерполяция координат
            const t = step / steps;
            const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // Кубическое easing
            
            const currentLat = fromLat + (toLat - fromLat) * easeT;
            const currentLng = fromLng + (toLng - fromLng) * easeT;
            
            animatedMarker.setLatLng([currentLat, currentLng]);
            
            step++;
            setTimeout(animate, stepTime);
        };
        
        // Запускаем анимацию
        animate();
    }
    
    // Добавление в очередь
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
        
        console.log(`📋 Добавлено в очередь: ${point.address?.substring(0, 50)}...`);
    }
    
    // Обработка очереди
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        
        this.processing = true;
        
        try {
            // Сортируем по приоритету
            this.queue.sort((a, b) => b.priority - a.priority);
            
            const maxConcurrent = CONFIG.GEOCODING.maxConcurrent || 3;
            const batch = this.queue.splice(0, Math.min(maxConcurrent, this.queue.length));
            
            console.log(`⚙️  Обработка очереди: ${batch.length} задач`);
            
            // Обновляем индикатор
            updateGeocodingIndicator(true, this.queue.length);
            
            await Promise.allSettled(
                batch.map(async (task) => {
                    try {
                        const result = await this.geocode(
                            task.address, 
                            task.region, 
                            task.pointId
                        );
                        
                        if (result && result.isExact) {
                            console.log(`✅ Очередь: успех для ${task.address?.substring(0, 40)}...`);
                        } else {
                            task.retryCount++;
                            task.priority = -1; // Понижаем приоритет
                            
                            if (task.retryCount <= CONFIG.GEOCODING.maxRetries) {
                                this.queue.push(task);
                            }
                        }
                    } catch (error) {
                        console.warn(`❌ Ошибка в очереди:`, error);
                    }
                })
            );
            
        } catch (error) {
            console.error('Ошибка обработки очереди:', error);
        } finally {
            this.processing = false;
            
            // Обновляем индикатор
            updateGeocodingIndicator(false, this.queue.length);
            
            // Если в очереди еще есть задачи, обрабатываем следующую партию
            if (this.queue.length > 0) {
                setTimeout(() => this.processQueue(), 2000);
            } else {
                console.log('📭 Очередь геокодирования пуста');
                this.saveCache();
            }
        }
    }
    
    // Запуск фонового геокодирования
    startBackgroundGeocoding() {
        if (!CONFIG.GEOCODING?.enabled) return;
        
        // Добавляем все точки с приблизительными координатами в очередь
        const pointsToGeocode = allPoints.filter(p => 
            p.address && 
            (p.isMock || !p.lat || !p.lng)
        );
        
        console.log(`🎯 Фоновое геокодирование: ${pointsToGeocode.length} точек для уточнения`);
        
        pointsToGeocode.forEach(point => {
            this.addToQueue(point);
        });
        
        // Запускаем обработку очереди
        if (pointsToGeocode.length > 0 && !this.processing) {
            setTimeout(() => this.processQueue(), 3000);
        }
    }
    
    // Вывод статистики
    printStats() {
        console.log('📊 Статистика геокодирования:');
        console.log(`   Всего запросов: ${this.stats.total}`);
        console.log(`   Из кэша: ${this.stats.cached}`);
        console.log(`   Яндекс нашел: ${this.stats.yandex}`);
        console.log(`   OSM нашел: ${this.stats.nominatim}`);
        console.log(`   Приблизительные: ${this.stats.approximate}`);
        console.log(`   Не найдено: ${this.stats.failed}`);
        console.log(`   Размер кэша: ${this.cache.size} записей`);
        console.log(`   В очереди: ${this.queue.length} задач`);
    }
    
    // Очистка кэша
    clearCache() {
        this.cache.clear();
        localStorage.removeItem('geocoding_cache');
        console.log('🧹 Кэш геокодирования очищен');
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========

function initApp() {
    console.log('Инициализация приложения...');
    initMap();
    
    // Инициализируем систему геокодирования
    if (CONFIG.GEOCODING?.enabled) {
        geocodingSystem = new GeocodingSystem();
        console.log('🚀 Система геокодирования инициализирована');
    }
    
    // Показываем демо-данные сразу
    showDemoData();
    
    // Загружаем реальные данные
    loadData();
    setupAutoUpdate();
    
    // Настраиваем автоматическую обработку очереди геокодирования
    if (geocodingSystem) {
        setInterval(() => {
            if (geocodingSystem.queue.length > 0 && !geocodingSystem.processing) {
                geocodingSystem.processQueue();
            }
        }, 30000);
    }
}

// Запускаем приложение при загрузке страницы
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
                
                if (statuses.includes('Закрыта') || statuses.includes('Отправлен ФО, не принят')) {
                    color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
                } else if (statuses.includes('На паузе')) {
                    color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
                } else if (statuses.includes('Активная') || statuses.includes('сдан') || statuses.includes('Сдан')) {
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

// ========== УТИЛИТЫ И ИНТЕРФЕЙС ==========
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
        messageElement.textContent = message;
        modal.style.display = 'flex';
    }
}

function updateModal(title, message) {
    const titleElement = document.getElementById('modal-title');
    const messageElement = document.getElementById('modal-message');
    
    if (titleElement && messageElement) {
        titleElement.textContent = title;
        messageElement.textContent = message;
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
            word-wrap: break-word;
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
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }
    }, duration);
}

// ========== ЗАГРУЗКА ДАННЫХ ==========
async function loadData() {
    if (isLoading) {
        console.log('Загрузка уже выполняется, пропускаем...');
        return;
    }
    
    isLoading = true;
    
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        console.log('Начинаю загрузку данных из Google Sheets...');
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Данные загружены: ${data.length} строк`);
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
        // Быстрое добавление координат
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`Координаты добавлены: ${allPoints.length}`);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // Запускаем фоновое геокодирование
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
    
    console.log(`Загружаю CSV по URL: ${url}`);
    
    try {
        const response = await fetch(url);
        console.log(`Статус ответа: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        console.log(`CSV загружен, размер: ${csvText.length} символов`);
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
                
                // Начало кавычек
                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                    continue;
                }
                
                // Конец кавычек
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
                
                // Разделитель вне кавычек
                if (char === ',' && !inQuotes) {
                    row.push(current.trim());
                    current = '';
                    continue;
                }
                
                // Добавляем символ
                current += char;
            }
            
            // Добавляем последнюю ячейку
            row.push(current.trim());
            
            // Убираем кавычки из ячеек
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
        
        console.log(`Парсинг CSV: ${result.length} строк, ${result[0]?.length || 0} колонок`);
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
        console.warn('Мало данных для обработки');
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
        
        // Создаем точку
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
        
        // Заполняем данные из соответствующих колонок
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length && row[index]) {
                const value = row[index].toString().trim();
                if (value) {
                    point[key] = value;
                }
            }
        });
        
        // Нормализуем адрес для российского формата
        if (point.address && geocodingSystem) {
            point.originalAddress = point.address;
            point.address = geocodingSystem.normalizeRussianAddress(point.address, point.region);
        }
        
        // Группируем статусы
        if (point.status && CONFIG.STATUS_MAPPING) {
            point.originalStatus = point.status;
            point.status = CONFIG.STATUS_MAPPING[point.status] || point.status;
        }
        
        // Если нет названия, используем часть адреса
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
        
        // Добавляем точку если есть данные
        if (point.name || point.address || point.region) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек: ${points.length}`);
    return points;
}

function findColumnIndices(headers) {
    console.log('🔍 Определяю колонки для заголовков:');
    headers.forEach((h, i) => console.log(`  [${i}] "${h}"`));
    
    const indices = {
        name: -1,
        region: -1,
        address: -1,
        status: -1,
        manager: -1,
        contractor: -1
    };
    
    // Для вашей конкретной таблицы - жесткое назначение
    if (headers.length >= 6) {
        // Стандартный порядок: Название ТТ, Регион, Адрес, Статус ТТ, Менеджер ФИО, Подрядчик ФИО
        const standardOrder = {
            name: 0,      // "Название ТТ"
            region: 1,    // "Регион"
            address: 2,   // "Адрес"
            status: 3,    // "Статус ТТ"
            manager: 4,   // "Менеджер ФИО"
            contractor: 5 // "Подрядчик ФИО"
        };
        
        // Проверяем, что заголовки примерно соответствуют
        const header0 = headers[0]?.toLowerCase() || '';
        const header1 = headers[1]?.toLowerCase() || '';
        const header2 = headers[2]?.toLowerCase() || '';
        
        if (header0.includes('название') || header1.includes('регион') || header2.includes('адрес')) {
            console.log('✅ Обнаружена структура вашей таблицы, использую стандартный порядок колонок');
            return standardOrder;
        }
    }
    
    // Если не подходит стандартный порядок, ищем по содержимому
    const headersLower = headers.map(h => h.toString().toLowerCase().trim());
    
    // Ищем точные совпадения
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
                console.log(`✓ Точное совпадение: ${field} -> колонка ${index} ("${headers[index]}")`);
            }
        }
    });
    
    // Заполняем недостающие индексы по порядку
    let nextIndex = 0;
    Object.keys(indices).forEach(key => {
        if (indices[key] === -1) {
            while (Object.values(indices).includes(nextIndex) && nextIndex < headers.length) {
                nextIndex++;
            }
            if (nextIndex < headers.length) {
                indices[key] = nextIndex;
                console.log(`⚠️  Назначено по порядку: ${key} -> колонка ${nextIndex} ("${headers[nextIndex]}")`);
                nextIndex++;
            }
        }
    });
    
    console.log('📊 Итоговые индексы колонок:');
    Object.keys(indices).forEach(key => {
        const index = indices[key];
        const header = index !== -1 && index < headers.length ? headers[index] : 'N/A';
        console.log(`  ${key}: ${index} -> "${header}"`);
    });
    
    return indices;
}

// ========== БЫСТРОЕ ДОБАВЛЕНИЕ КООРДИНАТ ==========
async function addCoordinatesFast(points) {
    console.log('⚡ Быстрое добавление координат для', points.length, 'точек...');
    
    if (!geocodingSystem) {
        console.warn('Система геокодирования не инициализирована');
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
        
        if (i % 20 === 0) {
            console.log(`   Прогресс: ${i}/${points.length}`);
        }
        
        // Если уже есть точные координаты
        if (point.lat && point.lng && !point.isMock) {
            updatedPoints.push(point);
            continue;
        }
        
        // Проверяем кэш
        if (point.address) {
            const cached = geocodingSystem.getFromCache(point.originalAddress || point.address, point.region);
            
            if (cached) {
                // Используем координаты из кэша
                point.lat = cached.lat;
                point.lng = cached.lng;
                point.geocodingSource = cached.source;
                point.isMock = !cached.isExact;
                point.cached = true;
                
                updatedPoints.push(point);
                continue;
            }
        }
        
        // Используем приблизительные координаты для быстрого отображения
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
        } else {
            console.warn('Точка без координат:', point);
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
    } else {
        console.warn('Нет точек с координатами для отображения');
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
        isMock: point.isMock || false,
        zIndexOffset: point.isMock ? 0 : 100
    });
    
    marker.bindPopup(createPopupContent(point));
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || CONFIG.STATUS_COLORS.default;
    
    // Очищаем адрес для отображения
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.replace(/"/g, '');
        displayAddress = displayAddress.trim();
    }
    
    // Информация о точности координат
    let accuracyInfo = '';
    if (point.isMock) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        `;
    } else if (point.geocodingSource) {
        const sourceName = point.geocodingSource === 'yandex' ? 'Яндекс Карты' : 
                          point.geocodingSource === 'nominatim' ? 'OpenStreetMap' : 
                          point.geocodingSource === 'approximate' ? 'Приблизительные' : 
                          point.geocodingSource;
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #2ecc71; color: white; border-radius: 3px; font-size: 11px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-check-circle"></i> Точные координаты (${sourceName})
            </div>
        `;
    }
    
    return `
        <div style="min-width: 250px; max-width: 300px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Без названия'}
            </h4>
            
            <div style="margin-bottom: 10px; font-size: 12px; color: #7f8c8d;">
                <strong>Статус:</strong> 
                <span style="color: ${color}; font-weight: 500;">${point.status || 'Не указан'}</span>
                ${point.originalStatus && point.originalStatus !== point.status ? 
                    `<br><small style="color: #95a5a6;">(${point.originalStatus})</small>` : ''}
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px; word-break: break-word;">${displayAddress}</span>
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
            
            ${point.geocodedAt ? `
                <div style="margin-top: 10px; font-size: 10px; color: #95a5a6; text-align: right;">
                    Обновлено: ${new Date(point.geocodedAt).toLocaleString()}
                </div>
            ` : ''}
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
    if (!select) {
        console.error(`Select не найден: ${selectId}`);
        return;
    }
    
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
    
    console.log(`Заполнен фильтр ${selectId}: ${options.length} опций`);
}

function applyFilters() {
    console.log('Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    console.log('Активные фильтры:', activeFilters);
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры...');
    
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.selectedIndex = 0;
        }
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
    
    console.log(`Фильтрация: ${allPoints.length} -> ${filtered.length} точек`);
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
    
    // Очищаем адрес
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.replace(/"/g, '');
        displayAddress = displayAddress.trim();
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
            ${displayAddress ? `
                <p style="margin-bottom: 8px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px; word-break: break-word;">${displayAddress}</span>
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
                    <strong>Источник координат:</strong><br>
                    ${point.geocodingSource === 'yandex' ? 'Яндекс Карты' : 
                      point.geocodingSource === 'nominatim' ? 'OpenStreetMap' : 
                      point.geocodingSource === 'approximate' ? 'Приблизительные' : 
                      point.geocodingSource}
                </div>
            ` : ''}
        </div>
        
        ${point.originalAddress ? `
            <div style="margin-top: 15px; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 4px; font-size: 11px;">
                <strong>Исходный адрес:</strong><br>
                ${point.originalAddress.substring(0, 80)}${point.originalAddress.length > 80 ? '...' : ''}
            </div>
        ` : ''}
        
        ${point.isMock ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========== СТАТИСТИКА И ЛЕГЕНДА ==========
function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const approximatePoints = filteredPoints.filter(p => p.isMock).length;
    
    const totalPointsElement = document.getElementById('total-points');
    const shownPointsElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    
    if (totalPointsElement) {
        totalPointsElement.textContent = allPoints.length;
    }
    
    if (shownPointsElement) {
        shownPointsElement.textContent = shownPoints;
    }
    
    if (accuracyElement) {
        accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
    }
    
    console.log(`Статистика: всего ${allPoints.length}, показано ${shownPoints}, точные ${exactPoints}, приблизительные ${approximatePoints}`);
}

function updateGeocodingStats() {
    if (!geocodingSystem) return;
    
    const totalPoints = allPoints.length;
    const exactCoords = allPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const mockCoords = allPoints.filter(p => p.isMock).length;
    const noCoords = allPoints.filter(p => !p.lat || !p.lng).length;
    
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
                    <span style="color: #e74c3c;">●</span> Без координат: ${noCoords}
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
        if (point.status) {
            statuses.add(point.status);
        }
    });
    
    // Добавляем стандартные статусы, если их нет в данных
    ['Активная', 'На паузе', 'Закрыта', 'План'].forEach(status => {
        if (!statuses.has(status)) {
            statuses.add(status);
        }
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
        console.log('Автообновление настроено: каждые', CONFIG.UPDATE.interval / 60000, 'минут');
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
            address: 'Алтайский край, Мамонтово (с) (Нас.пункт), ул. Партизанская, 158',
            status: 'Активная',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            lat: 53.3481 + (Math.random() - 0.5) * 0.5,
            lng: 83.7794 + (Math.random() - 0.5) * 1.0,
            isMock: true,
            geocodingSource: 'approximate',
            originalAddress: 'Алтайский край, Мамонтово (с) (Нас.пункт), ул. Партизанская, 158'
        }
    ];
    
    updateFilters();
    updateStatistics();
    updateLegend();
    updateGeocodingStats();
    showPointsOnMap();
    
    updateStatus('Демо-данные загружены');
    showNotification('Используются демо-данные. Проверьте доступ к таблице.', 'warning');
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
    if (confirm('Очистить кэш геокодирования? Все сохраненные координаты будут удалены.')) {
        if (geocodingSystem) {
            geocodingSystem.clearCache();
        }
        localStorage.removeItem('geocoding_cache');
        showNotification('Кэш геокодирования очищен', 'success');
        
        // Перезагружаем данные
        setTimeout(() => {
            loadData();
        }, 1000);
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
            <p><strong>Приблизительные:</strong> ${stats.approximate}</p>
            <p><strong>Не найдено:</strong> ${stats.failed}</p>
            <p><strong>В очереди:</strong> ${geocodingSystem.queue.length} задач</p>
            <p><strong>Размер кэша:</strong> ${geocodingSystem.cache.size} записей</p>
            <hr>
            <p><small>Кэш хранится ${CONFIG.GEOCODING?.cacheDays || 30} дней</small></p>
        </div>
    `;
    
    showModal('Статистика геокодирования', message);
}

// ========== ФУНКЦИЯ ДЛЯ ТЕСТИРОВАНИЯ ==========
function testGeocoding() {
    if (!geocodingSystem) {
        console.log('Система геокодирования не инициализирована');
        return;
    }
    
    const testAddresses = [
        "Алтайский край, Мамонтово (с) (Нас.пункт), ул. Партизанская, 158",
        "658044, Алтайский край, Первомайский р-н, Боровиха с, 2-я Боровая ул, дом № зд. 31Б",
        "Алтайский крайул. Барнаул Юрина, 184А1",
        "Архангельская область / Кировская область, Подосиновский р-н, Подосиновец пгт, Свободы ул, дом № 49а"
    ];
    
    console.log('=== ТЕСТИРОВАНИЕ НОРМАЛИЗАЦИИ АДРЕСОВ ===');
    testAddresses.forEach((addr, i) => {
        console.log(`\nПример ${i + 1}:`);
        console.log('Исходный:', addr);
        console.log('Нормализованный:', geocodingSystem.normalizeRussianAddress(addr, 'Алтайский край'));
    });
    console.log('=== КОНЕЦ ТЕСТА ===');
}

// ========== УПРАВЛЕНИЕ ИНДИКАТОРОМ ГЕОКОДИРОВАНИЯ ==========
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
window.testGeocoding = testGeocoding;


