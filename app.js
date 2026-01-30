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
            osmNominatim: 0,
            osmOverpass: 0,
            cached: 0,
            failed: 0,
            approximate: 0,
            exact: 0
        };
        this.loadCache();
        this.regionCache = new Map();
        this.currentRequest = null;
        this.batchSize = 3;
        this.requestDelay = 1500;
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
    
    // Оптимизированная нормализация для OSM
    normalizeAddressForOSM(address, region = '') {
        if (!address) return '';
        
        let normalized = address.toString().trim();
        
        // Быстрые замены через один проход
        const replacements = [
            // Стандартизация регионов
            [/республика\s+/gi, 'респ. '],
            [/область\b/gi, 'обл.'],
            [/автономный\s+округ/gi, 'АО'],
            [/а\.о\./gi, 'АО'],
            
            // Населенные пункты
            [/город\b/gi, 'г.'],
            [/поселок\b/gi, 'п.'],
            [/село\b/gi, 'с.'],
            [/деревня\b/gi, 'д.'],
            [/пгт\b/gi, 'пгт'],
            [/рабочий\s+поселок/gi, 'рп'],
            [/рп\b/gi, 'рп'],
            
            // Улицы
            [/улица\b/gi, 'ул.'],
            [/проспект\b/gi, 'пр-кт'],
            [/проезд\b/gi, 'пр-д'],
            [/переулок\b/gi, 'пер.'],
            [/шоссе\b/gi, 'ш.'],
            [/бульвар\b/gi, 'б-р'],
            [/набережная\b/gi, 'наб.'],
            
            // Дом и строения
            [/дом\b/gi, 'д.'],
            [/строение\b/gi, 'стр.'],
            [/корпус\b/gi, 'корп.'],
            
            // Удаляем лишнее
            [/торг(?:овая)?\s*точка/gi, ''],
            [/магазин\b/gi, ''],
            [/тц\b/gi, ''],
            [/супермаркет\b/gi, ''],
            [/ориентир\b/gi, ''],
            [/рядом\s+с\b/gi, ''],
            [/напротив\b/gi, '']
        ];
        
        // Применяем все замены
        replacements.forEach(([pattern, replacement]) => {
            normalized = normalized.replace(pattern, replacement);
        });
        
        // Удаляем индексы
        normalized = normalized.replace(/\d{6},?\s*/g, '');
        
        // Удаляем скобки и их содержимое
        normalized = normalized.replace(/[\(\[].*?[\)\]]/g, '');
        
        // Чистка лишних символов
        normalized = normalized.replace(/["«»]/g, '');
        normalized = normalized.replace(/\s+/g, ' ');
        normalized = normalized.replace(/,+/g, ',');
        normalized = normalized.replace(/,\s*,/g, ',');
        normalized = normalized.replace(/^[.,\s]+|[.,\s]+$/g, '');
        
        // Стандартизация номера дома
        normalized = normalized.replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2');
        normalized = normalized.replace(/(\d+)\s+([а-яa-z])/gi, '$1$2');
        
        // Разбиваем и фильтруем части
        let parts = normalized.split(',')
            .map(part => part.trim())
            .filter(part => part && part.length > 1);
        
        // Удаляем дубликаты (чувствительно к регистру)
        parts = parts.filter((part, index, arr) => {
            const lower = part.toLowerCase();
            return arr.findIndex(p => p.toLowerCase() === lower) === index;
        });
        
        // Оптимизированный порядок для OSM
        parts = this.optimizeOSMOrder(parts, region);
        
        normalized = parts.join(', ');
        
        // Добавляем Россию если нужно
        if (normalized && !/россия|russia/i.test(normalized)) {
            if (/(обл\.|край|респ\.|АО)/i.test(normalized)) {
                normalized += ', Россия';
            }
        }
        
        return normalized.trim();
    }
    
    optimizeOSMOrder(parts, region = '') {
        if (parts.length <= 1) return parts;
        
        // Быстрая классификация
        const types = parts.map(part => {
            const lower = part.toLowerCase();
            if (/россия|russia/i.test(lower)) return 'country';
            if (/(обл\.|край|респ\.|АО)/i.test(lower)) return 'region';
            if (/район|р-н/i.test(lower)) return 'district';
            if (/^(г\.|пгт|с\.|п\.|рп|д\.)/i.test(lower)) return 'settlement';
            if (/^(ул\.|пр-кт|пер\.|ш\.|б-р|пр-д)/i.test(lower)) return 'street';
            if (/\d/.test(lower) && /(д\.|дом|стр\.|корп\.)/i.test(lower)) return 'house';
            if (/\d+/.test(lower)) return 'housenum';
            return 'other';
        });
        
        // Правильный порядок для OSM
        const order = ['country', 'region', 'district', 'settlement', 'street', 'house', 'housenum', 'other'];
        const result = [];
        
        order.forEach(type => {
            parts.forEach((part, i) => {
                if (types[i] === type && !result.includes(part)) {
                    result.push(part);
                }
            });
        });
        
        // Добавляем регион если отсутствует
        if (region && !result.some(p => p.includes(region))) {
            const regionIndex = order.indexOf('region');
            if (regionIndex !== -1) {
                const regionName = this.formatRegionForOSM(region);
                result.splice(regionIndex, 0, regionName);
            }
        }
        
        return result;
    }
    
    formatRegionForOSM(region) {
        if (!region) return '';
        
        let formatted = region.trim();
        if (!/обл\.|край|респ\.|АО/i.test(formatted)) {
            if (/область/i.test(formatted)) {
                formatted = formatted.replace(/область/i, 'обл.');
            } else {
                formatted += ' обл.';
            }
        }
        
        return formatted;
    }
    
    getCacheKey(address, region = '') {
        const normalized = this.normalizeAddressForOSM(address, region).toLowerCase();
        return btoa(encodeURIComponent(normalized)).replace(/[^a-zA-Z0-9]/g, '');
    }
    
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
    
    saveToCache(address, region = '', lat, lng, source = 'unknown', isExact = true) {
        if (!CONFIG.GEOCODING?.enabled) return;
        
        const cacheKey = this.getCacheKey(address, region);
        const normalized = this.normalizeAddressForOSM(address, region);
        
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
        
        // Экономное сохранение
        if (this.cache.size % 20 === 0) {
            setTimeout(() => this.saveCache(), 100);
        }
    }
    
    async geocodeOSM(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            const normalized = this.normalizeAddressForOSM(address, region);
            
            if (!normalized || normalized.length < 3) {
                return null;
            }
            
            const cached = this.getFromCache(address, region);
            if (cached) {
                return cached;
            }
            
            // 1. Пробуем Nominatim (точный поиск)
            let result = await this.geocodeNominatim(address, region);
            
            // 2. Если не нашли точно, ищем населенный пункт через Overpass
            if (!result || !result.isExact) {
                const settlementResult = await this.geocodeOverpassAPI(address, region);
                if (settlementResult) {
                    result = settlementResult;
                }
            }
            
            if (result) {
                this.stats.osmNominatim++;
                if (result.isExact) this.stats.exact++;
                
                this.saveToCache(
                    address, 
                    region, 
                    result.lat, 
                    result.lng, 
                    result.source, 
                    result.isExact !== false
                );
                
                return result;
            }
            
            this.stats.failed++;
            return null;
            
        } catch (error) {
            console.warn('❌ Ошибка OSM геокодирования:', error.message);
            this.stats.failed++;
            return null;
        }
    }
    
    async geocodeNominatim(address, region = '') {
        const normalized = this.normalizeAddressForOSM(address, region);
        const cleanAddress = normalized.replace(/,\s*Россия$/i, '');
        
        // Создаем оптимизированные запросы
        const queries = this.generateOptimizedOSMQueries(cleanAddress, region);
        
        for (const query of queries) {
            try {
                await this.delay(this.requestDelay);
                
                const result = await this.queryNominatim(query);
                if (result) {
                    console.log(`✅ OSM нашел: ${query.substring(0, 60)}...`);
                    return result;
                }
                
            } catch (error) {
                console.warn(`Ошибка запроса OSM:`, error.message);
                continue;
            }
        }
        
        return null;
    }
    
    generateOptimizedOSMQueries(address, region = '') {
        const queries = new Set();
        const parts = address.split(',').map(p => p.trim()).filter(p => p);
        
        if (parts.length === 0) return [];
        
        // 1. Полный адрес
        queries.add(address);
        
        // 2. Без номера дома
        const withoutHouse = address.replace(/,\s*(д\.|дом|стр\.|корп\.).*$/i, '').trim();
        if (withoutHouse !== address) {
            queries.add(withoutHouse);
        }
        
        // 3. Ищем улицу и город
        const streetIndex = parts.findIndex(p => /^(ул\.|пр-кт|пер\.|ш\.)/i.test(p));
        const cityIndex = parts.findIndex(p => /^(г\.|пгт|с\.|п\.)/i.test(p));
        
        if (streetIndex !== -1 && cityIndex !== -1) {
            queries.add(`${parts[cityIndex]}, ${parts[streetIndex]}`);
        }
        
        // 4. Только город
        if (cityIndex !== -1) {
            queries.add(parts[cityIndex]);
            
            // С регионом
            const regionIndex = parts.findIndex(p => /(обл\.|край|респ\.)/i.test(p));
            if (regionIndex !== -1) {
                queries.add(`${parts[regionIndex]}, ${parts[cityIndex]}`);
            }
        }
        
        // 5. Добавляем регион из параметра
        if (region && !address.toLowerCase().includes(region.toLowerCase())) {
            const regionName = this.formatRegionForOSM(region);
            queries.add(`${regionName}, ${address}`);
        }
        
        // Сортируем от коротких к длинным (более вероятные)
        return Array.from(queries)
            .filter(q => q && q.length >= 3)
            .sort((a, b) => a.length - b.length)
            .slice(0, 5); // Ограничиваем 5 запросами
    }
    
    async queryNominatim(query) {
        const encoded = encodeURIComponent(query);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=3&countrycodes=ru&accept-language=ru`;
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': CONFIG.GEOCODING.osmUserAgent || 'TTMapApp/1.0',
                    'Accept': 'application/json',
                    'Accept-Language': 'ru'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data && data.length > 0) {
                    // Выбираем лучший результат
                    const best = this.selectBestOSMResult(data, query);
                    
                    if (best) {
                        const lat = parseFloat(best.lat);
                        const lon = parseFloat(best.lon);
                        
                        if (lon >= 19 && lon <= 180 && lat >= 41 && lat <= 82) {
                            return {
                                lat: lat,
                                lng: lon,
                                source: 'nominatim',
                                isExact: this.isExactOSMResult(best, query),
                                displayName: best.display_name || '',
                                type: best.type,
                                importance: best.importance || 0
                            };
                        }
                    }
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
    
    selectBestOSMResult(results, query) {
        if (results.length === 1) return results[0];
        
        // Приоритет по точности
        const priority = {
            'house': 100,
            'residential': 90,
            'street': 80,
            'village': 70,
            'town': 60,
            'city': 50,
            'administrative': 40,
            'other': 10
        };
        
        return results.reduce((best, current) => {
            const currentScore = (current.importance || 0) * 10 + (priority[current.type] || 1);
            const bestScore = (best.importance || 0) * 10 + (priority[best.type] || 1);
            
            return currentScore > bestScore ? current : best;
        }, results[0]);
    }
    
    isExactOSMResult(result, query) {
        // Быстрая проверка точности
        if (result.type === 'house' || result.type === 'residential') return true;
        
        const queryLower = query.toLowerCase();
        const displayLower = (result.display_name || '').toLowerCase();
        
        // Проверяем номер дома
        const houseNum = queryLower.match(/\d+/);
        if (houseNum && displayLower.includes(houseNum[0])) return true;
        
        // Проверяем ключевые слова
        const queryWords = queryLower.split(/[,\s]+/).filter(w => w.length > 2);
        const displayWords = displayLower.split(/[,\s]+/).filter(w => w.length > 2);
        
        let matches = 0;
        queryWords.forEach(qw => {
            if (displayWords.some(dw => dw.includes(qw) || qw.includes(dw))) {
                matches++;
            }
        });
        
        return matches / queryWords.length >= 0.7;
    }
    
    async geocodeOverpassAPI(address, region = '') {
        const settlementName = this.extractSettlementName(address);
        if (!settlementName) return null;
        
        // Кэш для населенных пунктов
        const cacheKey = `settlement_${settlementName.toLowerCase()}`;
        if (this.regionCache.has(cacheKey)) {
            return this.regionCache.get(cacheKey);
        }
        
        try {
            const query = `
                [out:json][timeout:20];
                area["ISO3166-1"="RU"]->.russia;
                (
                    node["place"~"city|town|village|hamlet"]["name"~"${settlementName}",i](area.russia);
                    way["place"~"city|town|village|hamlet"]["name"~"${settlementName}",i](area.russia);
                );
                out center;
            `;
            
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, { 
                signal: controller.signal,
                headers: {
                    'User-Agent': CONFIG.GEOCODING.osmUserAgent || 'TTMapApp/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.elements && data.elements.length > 0) {
                    const element = data.elements[0];
                    const lat = element.lat || (element.center && element.center.lat);
                    const lon = element.lon || (element.center && element.center.lon);
                    
                    if (lat && lon) {
                        const result = {
                            lat: lat,
                            lng: lon,
                            source: 'overpass',
                            isExact: false,
                            settlement: settlementName,
                            type: element.tags?.place
                        };
                        
                        this.stats.osmOverpass++;
                        this.regionCache.set(cacheKey, result);
                        
                        return result;
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
        
        const parts = address.split(',').map(p => p.trim());
        
        for (const part of parts) {
            // Проверяем с префиксом
            const match = part.match(/^(г\.|с\.|п\.|пгт|рп|д\.|пос\.)\s*(.+)$/i);
            if (match && match[2].length > 2) {
                return match[2].trim();
            }
            
            // Без префикса (просто название)
            if (part.length > 3 && part.length < 30 && 
                !/\d/.test(part) && 
                !/ул\.|обл\.|край|район/i.test(part)) {
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
        
        const result = await this.geocodeOSM(address, region);
        
        if (result) {
            if (pointId) {
                this.updatePointAndMarker(pointId, result.lat, result.lng, result.source);
            }
            return result;
        }
        
        // Если OSM не нашел, возвращаем приблизительные координаты
        this.stats.failed++;
        const approximate = this.getApproximateCoordinates(address, region);
        
        this.saveToCache(
            address, 
            region, 
            approximate.lat, 
            approximate.lng, 
            'approximate', 
            false
        );
        
        return approximate;
    }
    
    getApproximateCoordinates(address, region = '') {
        // Упрощенный список регионов для быстрого поиска
        const regionCoords = {
            'москва': { lat: 55.7558, lng: 37.6173, radius: 0.05 },
            'московск': { lat: 55.7558, lng: 37.6173, radius: 0.1 },
            'спб|петербург': { lat: 59.9343, lng: 30.3351, radius: 0.05 },
            'ленинград': { lat: 59.9343, lng: 30.3351, radius: 0.1 },
            'алтайск': { lat: 53.3481, lng: 83.7794, radius: 0.3 },
            'краснодар': { lat: 45.0355, lng: 38.9753, radius: 0.2 },
            'свердлов': { lat: 56.8389, lng: 60.6057, radius: 0.1 },
            'ростов': { lat: 47.2224, lng: 39.7189, radius: 0.2 },
            'татарстан': { lat: 55.7961, lng: 49.1064, radius: 0.1 },
            'челябин': { lat: 55.1644, lng: 61.4368, radius: 0.1 }
        };
        
        let baseLat = 55.7558;
        let baseLng = 37.6173;
        let radius = 3.0;
        
        const searchText = (region || address || '').toLowerCase();
        
        for (const [pattern, coords] of Object.entries(regionCoords)) {
            if (new RegExp(pattern).test(searchText)) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                radius = coords.radius;
                break;
            }
        }
        
        // Случайные смещения
        const randomLat = baseLat + (Math.random() - 0.5) * radius;
        const randomLng = baseLng + (Math.random() - 0.5) * radius * 1.5;
        
        this.stats.approximate++;
        
        return {
            lat: randomLat,
            lng: randomLng,
            source: 'approximate',
            isExact: false,
            isMock: true,
            normalized: this.normalizeAddressForOSM(address, region)
        };
    }
    
    updatePointAndMarker(pointId, lat, lng, source) {
        const pointIndex = allPoints.findIndex(p => p.id === pointId);
        if (pointIndex === -1) return;
        
        const point = allPoints[pointIndex];
        point.lat = lat;
        point.lng = lng;
        point.isMock = false;
        point.geocodingSource = source;
        point.geocodedAt = new Date().toISOString();
        
        if (markersMap.has(pointId)) {
            const marker = markersMap.get(pointId);
            marker.setLatLng([lat, lng]);
            marker.bindPopup(createPopupContent(point));
            
            const markerElement = marker.getElement();
            if (markerElement) {
                markerElement.classList.add('marker-updated');
                setTimeout(() => {
                    if (markerElement) markerElement.classList.remove('marker-updated');
                }, 2000);
            }
        }
        
        updateStatistics();
        updateGeocodingStats();
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
    }
    
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        try {
            // Сортируем по приоритету
            this.queue.sort((a, b) => b.priority - a.priority);
            
            // Батчинг для ускорения
            const batchSize = Math.min(this.batchSize, this.queue.length);
            const batch = this.queue.splice(0, batchSize);
            
            console.log(`⚙️  Пакетная обработка: ${batch.length} задач`);
            
            updateGeocodingIndicator(true, this.queue.length);
            
            // Параллельная обработка батча
            const promises = batch.map(async (task) => {
                try {
                    const result = await this.geocode(task.address, task.region, task.pointId);
                    
                    if (!result || !result.isExact) {
                        task.retryCount++;
                        task.priority = -1;
                        
                        if (task.retryCount <= (CONFIG.GEOCODING.maxRetries || 2)) {
                            this.queue.push(task);
                        }
                    }
                    
                    // Задержка между запросами для соблюдения лимитов OSM
                    await this.delay(this.requestDelay / batchSize);
                    
                } catch (error) {
                    console.warn('❌ Ошибка в очереди:', error.message);
                    task.retryCount++;
                    if (task.retryCount <= (CONFIG.GEOCODING.maxRetries || 2)) {
                        this.queue.push(task);
                    }
                }
            });
            
            await Promise.all(promises);
            
        } catch (error) {
            console.error('❌ Ошибка обработки очереди:', error);
        } finally {
            this.processing = false;
            updateGeocodingIndicator(false, this.queue.length);
            
            // Продолжаем обработку если есть задачи
            if (this.queue.length > 0) {
                setTimeout(() => this.processQueue(), 2000);
            } else {
                console.log('📭 Очередь пуста');
                showNotification('Геокодирование завершено', 'success', 3000);
            }
        }
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
            setTimeout(() => this.processQueue(), 2000);
        }
    }
    
    printStats() {
        console.log('📊 Статистика геокодирования:');
        console.log(`   Всего: ${this.stats.total}`);
        console.log(`   Из кэша: ${this.stats.cached}`);
        console.log(`   OSM Nominatim: ${this.stats.osmNominatim}`);
        console.log(`   OSM Overpass: ${this.stats.osmOverpass}`);
        console.log(`   Точные: ${this.stats.exact}`);
        console.log(`   Приблизительные: ${this.stats.approximate}`);
        console.log(`   Ошибки: ${this.stats.failed}`);
        console.log(`   Размер кэша: ${this.cache.size}`);
        console.log(`   Очередь: ${this.queue.length}`);
    }
    
    clearCache() {
        this.cache.clear();
        this.regionCache.clear();
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
        console.log('🚀 Система геокодирования OSM инициализирована');
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
            setTimeout(() => geocodingSystem.startBackgroundGeocoding(), 3000);
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
            point.address = geocodingSystem.normalizeAddressForOSM(point.address, point.region);
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
        
        // Быстрое приблизительное расположение
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
                <i class="fas fa-check-circle"></i> Координаты OSM (${sourceName})
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
                    ${point.geocodingSource === 'nominatim' ? 'OSM Nominatim' : 
                      point.geocodingSource === 'overpass' ? 'OSM Overpass' : 
                      point.geocodingSource === 'approximate' ? 'Приблизительные' : 
                      point.geocodingSource}
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
                <i class="fas fa-map-marker-alt"></i> Статистика OSM:
            </div>
            <div style="display: flex; gap: 15px; font-size: 11px;">
                <div>
                    <span style="color: #2ecc71;">●</span> Точные: ${exactCoords}
                </div>
                <div>
                    <span style="color: #f39c12;">●</span> Приблизительные: ${mockCoords}
                </div>
            </div>
            <div style="margin-top: 8px; font-size: 10px; color: #7f8c8d;">
                <div>OSM Nominatim: ${stats.osmNominatim} | OSM Overpass: ${stats.osmOverpass}</div>
                <div>Из кэша: ${stats.cached} | Всего запросов: ${stats.total}</div>
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
            geocodingSource: 'nominatim'
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
            geocodingSource: 'nominatim'
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
    
    showNotification(`Уточнение координат OSM для ${pointsToGeocode.length} точек...`, 'info');
    
    pointsToGeocode.forEach(point => {
        geocodingSystem.addToQueue(point);
    });
    
    if (!geocodingSystem.processing) {
        geocodingSystem.processQueue();
    }
}

function clearGeocodingCache() {
    if (confirm('Очистить кэш геокодирования OSM?')) {
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
            <h4>📊 Статистика геокодирования OSM</h4>
            <p><strong>Всего запросов:</strong> ${stats.total}</p>
            <p><strong>Из кэша:</strong> ${stats.cached}</p>
            <p><strong>OSM Nominatim:</strong> ${stats.osmNominatim}</p>
            <p><strong>OSM Overpass:</strong> ${stats.osmOverpass}</p>
            <p><strong>Точные координаты:</strong> ${stats.exact}</p>
            <p><strong>Приблизительные:</strong> ${stats.approximate}</p>
            <p><strong>Не найдено:</strong> ${stats.failed}</p>
            <p><strong>В очереди:</strong> ${geocodingSystem.queue.length} задач</p>
            <p><strong>Размер кэша:</strong> ${geocodingSystem.cache.size} записей</p>
        </div>
    `;
    
    showModal('Статистика геокодирования OSM', message);
}

// ========== ИНДИКАТОР ГЕОКОДИРОВАНИЯ ==========

function updateGeocodingIndicator(active, queueSize = 0) {
    const indicator = document.getElementById('geocoding-indicator');
    const textElement = document.getElementById('geocoding-indicator-text');
    
    if (!indicator || !textElement) return;
    
    if (active || queueSize > 0) {
        indicator.style.display = 'flex';
        if (active) {
            textElement.textContent = `OSM геокодирование... (${queueSize} в очереди)`;
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
