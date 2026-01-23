// ============================================================================
// АВТОНОМНЫЙ ГЕОКОДЕР ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ
// Работает без API ключей, использует открытые источники
// ============================================================================

class AutonomousGeocoder {
    constructor() {
        this.cache = {};
        this.localDB = this._initLocalDB();
        this.ai = new AddressAI();
        this.requestDelay = 1000; // Задержка между запросами в мс
        this.timeout = 15000; // Таймаут запросов
        this.onlineAvailable = true;
        this.quickCache = new Map();
    }

    // Инициализация локальной базы координат
    _initLocalDB() {
        return {
            // Москва и МО
            "москва красная площадь": { lat: 55.7539, lng: 37.6208 },
            "москва кремль": { lat: 55.7520, lng: 37.6178 },
            "москва ул тверская": { lat: 55.7606, lng: 37.6056 },
            
            // Санкт-Петербург
            "санкт-петербург невский проспект": { lat: 59.9358, lng: 30.3259 },
            "санкт-петербург эрмитаж": { lat: 59.9398, lng: 30.3146 },
            
            // Алтайский край
            "алтайский край барнаул ул попова 114/1": { lat: 53.3606, lng: 83.7636 },
            "алтайский край барнаул": { lat: 53.3606, lng: 83.7636 },
            "алтайский край бийск": { lat: 52.5410, lng: 85.2190 },
            
            // Другие крупные города
            "екатеринбург проспект ленина": { lat: 56.8380, lng: 60.5973 },
            "казань ул баумана": { lat: 55.7905, lng: 49.1147 },
            "новосибирск ул ленина": { lat: 55.0302, lng: 82.9204 },
            "краснодар ул красная": { lat: 45.0355, lng: 38.9753 },
            "сочи курортный проспект": { lat: 43.5855, lng: 39.7231 },
            "ростов-на-дону пр-кт стачки": { lat: 47.2214, lng: 39.7114 },
            "нижний новгород ул большая покровская": { lat: 56.3269, lng: 44.0065 },
            "волгоград мамаев курган": { lat: 48.7423, lng: 44.5371 },
            "владивосток золотой мост": { lat: 43.1167, lng: 131.9000 },
            
            // Региональные центры
            "тверь": { lat: 56.8587, lng: 35.9176 },
            "ярославль": { lat: 57.6261, lng: 39.8845 },
            "иваново": { lat: 57.0004, lng: 40.9739 },
            "брянск": { lat: 53.2436, lng: 34.3642 },
            "курск": { lat: 51.7304, lng: 36.1926 },
            "липецк": { lat: 52.6088, lng: 39.5992 },
            "оренбург": { lat: 51.7682, lng: 55.0974 },
            "пенза": { lat: 53.2001, lng: 45.0047 },
            "астрахань": { lat: 46.3497, lng: 48.0408 },
            "махачкала": { lat: 42.9831, lng: 47.5047 },
            "калининград": { lat: 54.7104, lng: 20.4522 },
            "симферополь": { lat: 44.9521, lng: 34.1024 },
            "севастополь": { lat: 44.6166, lng: 33.5254 }
        };
    }

    // Нормализация адреса
    normalizeAddress(address) {
        if (!address) return "";
        
        let normalized = address.toLowerCase()
            .replace(/ул\./g, 'улица')
            .replace(/пр\./g, 'проспект')
            .replace(/пр-кт/g, 'проспект')
            .replace(/пр-т/g, 'проспект')
            .replace(/д\./g, 'дом')
            .replace(/корп\./g, 'корпус')
            .replace(/г\./g, 'город')
            .replace(/с\./g, 'село')
            .replace(/обл\./g, 'область')
            .replace(/респ\./g, 'республика')
            .replace(/кр\./g, 'край')
            .replace(/ш\./g, 'шоссе')
            .replace(/б-р/g, 'бульвар')
            .replace(/пер\./g, 'переулок')
            .replace(/пл\./g, 'площадь')
            .replace(/ст-ца/g, 'станица')
            .replace(/мкр/g, 'микрорайон')
            .replace(/кв-л/g, 'квартал')
            .replace(/р-н/g, 'район');
        
        // Убираем лишние символы
        normalized = normalized.replace(/[^\w\s\d/,.-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        return normalized;
    }

    // Проверка кэша
    getFromCache(address) {
        const normalized = this.normalizeAddress(address);
        const cacheKey = `geocode_${normalized}`;
        
        // Проверяем быстрый кэш
        if (this.quickCache.has(cacheKey)) {
            return this.quickCache.get(cacheKey);
        }
        
        // Проверяем localStorage
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            try {
                const data = JSON.parse(cached);
                // Кэш на 90 дней
                if (Date.now() - data.timestamp < 90 * 24 * 60 * 60 * 1000) {
                    this.quickCache.set(cacheKey, data.result);
                    return data.result;
                }
            } catch (e) {
                // Ошибка парсинга - очищаем
                localStorage.removeItem(cacheKey);
            }
        }
        
        return null;
    }

    // Сохранение в кэш
    saveToCache(address, result) {
        const normalized = this.normalizeAddress(address);
        const cacheKey = `geocode_${normalized}`;
        const cacheData = {
            result: result,
            timestamp: Date.now()
        };
        
        try {
            // Сохраняем в быстрый кэш
            this.quickCache.set(cacheKey, result);
            
            // Сохраняем в localStorage
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
            
            // Также сохраняем в локальную базу для быстрого доступа
            if (normalized && !this.localDB[normalized]) {
                this.localDB[normalized] = { lat: result.lat, lng: result.lng };
            }
            
        } catch (e) {
            // Если localStorage переполнен, удаляем старые записи
            this._cleanupCache();
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        }
    }

    // Очистка кэша
    _cleanupCache() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('geocode_')) {
                keys.push(key);
            }
        }
        
        // Сортируем по времени и удаляем старые
        keys.sort((a, b) => {
            const dataA = JSON.parse(localStorage.getItem(a) || '{}');
            const dataB = JSON.parse(localStorage.getItem(b) || '{}');
            return (dataA.timestamp || 0) - (dataB.timestamp || 0);
        });
        
        // Удаляем половину старых записей
        const toDelete = keys.slice(0, Math.floor(keys.length / 2));
        toDelete.forEach(key => {
            localStorage.removeItem(key);
            this.quickCache.delete(key);
        });
    }

    // Быстрое геокодирование для мгновенной загрузки
    async quickGeocode(address, region = '', city = '') {
        if (!address || address.trim().length < 3) {
            return null;
        }
        
        const startTime = Date.now();
        const normalized = this.normalizeAddress(address);
        
        // 1. Проверяем быстрый кэш (в памяти)
        const cacheKey = `geocode_${normalized}`;
        if (this.quickCache.has(cacheKey)) {
            console.log(`⚡ Быстрый кэш: ${Date.now() - startTime}ms`);
            return this.quickCache.get(cacheKey);
        }
        
        // 2. Проверяем localStorage кэш
        const cached = this.getFromCache(address);
        if (cached) {
            this.quickCache.set(cacheKey, cached);
            console.log(`⚡ localStorage кэш: ${Date.now() - startTime}ms`);
            return cached;
        }
        
        // 3. Пробуем локальную базу (самый быстрый способ)
        const localResult = this.geocodeLocal(address);
        if (localResult) {
            this.quickCache.set(cacheKey, localResult);
            this.saveToCache(address, localResult);
            console.log(`⚡ Локальная база: ${Date.now() - startTime}ms`);
            return localResult;
        }
        
        // 4. Для быстрой загрузки используем региональные координаты
        const regionalCoords = this.getRegionalCoordinates(region, city);
        if (regionalCoords) {
            const quickResult = {
                lat: regionalCoords.lat,
                lng: regionalCoords.lng,
                address: address,
                source: 'Quick Regional',
                precision: 'low',
                isApproximate: true
            };
            
            this.quickCache.set(cacheKey, quickResult);
            this.saveToCache(address, quickResult);
            console.log(`⚡ Региональные координаты: ${Date.now() - startTime}ms`);
            return quickResult;
        }
        
        return null;
    }

    // Геокодирование через Nominatim (OpenStreetMap)
    async geocodeNominatim(address) {
        try {
            // Задержка для соблюдения лимитов Nominatim
            await this._delay(this.requestDelay);
            
            const encodedAddress = encodeURIComponent(address);
            const url = `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&addressdetails=1&limit=1`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'TTMapApp/1.0',
                    'Accept-Language': 'ru',
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.length > 0) {
                    return {
                        lat: parseFloat(data[0].lat),
                        lng: parseFloat(data[0].lon),
                        address: data[0].display_name || address,
                        source: 'OpenStreetMap',
                        precision: 'high'
                    };
                }
            }
        } catch (error) {
            console.warn('Nominatim error:', error);
        }
        
        return null;
    }

    // Геокодирование через Яндекс (без API)
    async geocodeYandex(address) {
        try {
            const encodedAddress = encodeURIComponent(address);
            const url = `https://yandex.ru/maps/213/moscow/?text=${encodedAddress}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const html = await response.text();
                
                // Ищем координаты в различных форматах
                const patterns = [
                    /data-coordinates="([^"]+)"/,
                    /coordinates=([\d.,]+)/,
                    /"coordinates":\s*\[([\d.,]+)\]/,
                    /center=([\d.,]+)&/
                ];
                
                for (const pattern of patterns) {
                    const match = pattern.exec(html);
                    if (match) {
                        const coordsStr = match[1];
                        if (coordsStr.includes(',')) {
                            const parts = coordsStr.split(',');
                            if (parts.length >= 2) {
                                // Яндекс возвращает долготу, широту
                                const lng = parseFloat(parts[0].trim());
                                const lat = parseFloat(parts[1].trim());
                                
                                return {
                                    lat: lat,
                                    lng: lng,
                                    address: address,
                                    source: 'Yandex Maps',
                                    precision: 'medium'
                                };
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('Yandex error:', error);
        }
        
        return null;
    }

    // Геокодирование через 2GIS
    async geocode2GIS(address) {
        try {
            const normalized = this.normalizeAddress(address);
            const encodedAddress = encodeURIComponent(normalized);
            const url = `https://2gis.ru/search/${encodedAddress}`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const html = await response.text();
                
                // Ищем JSON-LD с координатами
                const pattern = /"geo":\s*\{[^}]*"latitude":\s*([\d.]+)[^}]*"longitude":\s*([\d.]+)/;
                const match = pattern.exec(html);
                
                if (match) {
                    const lat = parseFloat(match[1]);
                    const lng = parseFloat(match[2]);
                    
                    // Ищем название
                    const namePattern = /"name":\s*"([^"]+)"/;
                    const nameMatch = namePattern.exec(html);
                    
                    return {
                        lat: lat,
                        lng: lng,
                        address: nameMatch ? nameMatch[1] : address,
                        source: '2GIS',
                        precision: 'medium'
                    };
                }
            }
        } catch (error) {
            console.warn('2GIS error:', error);
        }
        
        return null;
    }

    // Поиск в локальной базе
    geocodeLocal(address) {
        const normalized = this.normalizeAddress(address);
        
        // Варианты для поиска
        const searchVariants = [
            normalized,
            normalized.split(' ').slice(0, 8).join(' '),
            normalized.split(' ').slice(0, 6).join(' '),
            normalized.split(' ').slice(0, 4).join(' '),
            normalized.split(' ').filter(word => word.length > 3).join(' ')
        ];
        
        for (const variant of searchVariants) {
            if (variant && this.localDB[variant]) {
                return {
                    lat: this.localDB[variant].lat,
                    lng: this.localDB[variant].lng,
                    address: variant,
                    source: 'Local Database',
                    precision: 'high'
                };
            }
        }
        
        return null;
    }

    // Улучшенный поиск по городу/региону
    getRegionalCoordinates(region, city) {
        // База координат городов и регионов
        const cityDB = {
            'москва': { lat: 55.7558, lng: 37.6173 },
            'санкт-петербург': { lat: 59.9343, lng: 30.3351 },
            'новосибирск': { lat: 55.0084, lng: 82.9357 },
            'екатеринбург': { lat: 56.8389, lng: 60.6057 },
            'казань': { lat: 55.7961, lng: 49.1064 },
            'нижний новгород': { lat: 56.3269, lng: 44.0065 },
            'челябинск': { lat: 55.1644, lng: 61.4368 },
            'самара': { lat: 53.2415, lng: 50.2212 },
            'омск': { lat: 54.9893, lng: 73.3682 },
            'ростов-на-дону': { lat: 47.2357, lng: 39.7015 },
            'уфа': { lat: 54.7351, lng: 55.9587 },
            'красноярск': { lat: 56.0090, lng: 92.8726 },
            'пермь': { lat: 58.0105, lng: 56.2294 },
            'воронеж': { lat: 51.6606, lng: 39.2006 },
            'волгоград': { lat: 48.7071, lng: 44.5170 },
            'краснодар': { lat: 45.0355, lng: 38.9753 },
            'тюмень': { lat: 57.1530, lng: 65.5343 },
            'барнаул': { lat: 53.3548, lng: 83.7698 },
            'иркутск': { lat: 52.2896, lng: 104.2806 },
            'хабаровск': { lat: 48.4802, lng: 135.0719 },
            'владивосток': { lat: 43.1155, lng: 131.8855 },
            'тверь': { lat: 56.8587, lng: 35.9176 },
        };
        
        const searchText = (city || region || '').toLowerCase();
        
        for (const [cityName, coords] of Object.entries(cityDB)) {
            if (searchText.includes(cityName)) {
                // Добавляем небольшое случайное смещение
                return {
                    lat: coords.lat + (Math.random() - 0.5) * 0.02,
                    lng: coords.lng + (Math.random() - 0.5) * 0.04
                };
            }
        }
        
        return null;
    }

    // Основная функция геокодирования
    async geocode(address, region = '', city = '') {
        if (!address || address.trim().length < 3) {
            return null;
        }
        
        // 1. Быстрое геокодирование для мгновенного отображения
        const quickResult = await this.quickGeocode(address, region, city);
        if (quickResult) {
            return quickResult;
        }
        
        // 2. Если адрес хороший, пробуем онлайн-геокодирование
        const aiResult = this.ai.predict(address);
        
        if (aiResult.score > 0.4 && this.onlineAvailable) {
            const sources = [
                this.geocodeNominatim.bind(this),
                this.geocodeYandex.bind(this),
                this.geocode2GIS.bind(this)
            ];
            
            for (const source of sources) {
                try {
                    const result = await source(address);
                    if (result) {
                        this.saveToCache(address, result);
                        return result;
                    }
                } catch (error) {
                    console.warn(`Geocoding source error:`, error);
                    continue;
                }
            }
        }
        
        // 3. Если ничего не нашли, возвращаем случайные координаты по региону
        const regionalCoords = this.getRegionalCoordinates(region, city);
        if (regionalCoords) {
            const result = {
                lat: regionalCoords.lat,
                lng: regionalCoords.lng,
                address: address,
                source: 'Regional Approximation',
                precision: 'low',
                isApproximate: true
            };
            
            this.saveToCache(address, result);
            return result;
        }
        
        return null;
    }

    // Пакетное геокодирование
    async batchGeocode(addresses, progressCallback = null) {
        const results = [];
        const BATCH_SIZE = 5;
        
        for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
            const batch = addresses.slice(i, i + BATCH_SIZE);
            
            if (progressCallback) {
                progressCallback(i, addresses.length);
            }
            
            const batchPromises = batch.map(async (item, index) => {
                const result = await this.geocode(item.address, item.region, item.city);
                return {
                    ...item,
                    geocoded: !!result,
                    coordinates: result ? { lat: result.lat, lng: result.lng } : null,
                    source: result ? result.source : null,
                    isApproximate: result ? result.isApproximate : false
                };
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                }
            });
            
            // Задержка между пакетами
            if (i + BATCH_SIZE < addresses.length) {
                await this._delay(2000);
            }
        }
        
        return results;
    }

    // Вспомогательные функции
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// ИИ ДЛЯ ОЦЕНКИ КАЧЕСТВА АДРЕСОВ
// ============================================================================

class AddressAI {
    constructor() {
        this.patterns = {
            postalCode: /\b\d{6}\b/,
            region: /(?:^|\s)([А-ЯЁ][а-яё]+\s*(?:край|область|обл\.?|Республика|Респ\.?|АО))/i,
            city: /(?:г\.|город|с\.|село|пгт|рп|посёлок|поселок)\s*([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)/i,
            street: /(?:ул\.|улица|пр\.|проспект|пр-кт|б-р|бульвар|пер\.|переулок|ш\.|шоссе)\s*([^,\d]+?)(?=,|\d|$)/i,
            house: /(?:дом|д\.|№|корпус|корп\.|к\.|строение|стр\.|литер|лит\.)\s*([\w\d/\\-]+)/i,
        };
        
        this.weights = {
            postalCode: 0.3,
            region: 0.2,
            city: 0.25,
            street: 0.25,
            house: 0.2,
            commaCount: 0.05,
            minLength: 0.1,
        };
    }
    
    extractFeatures(address) {
        const features = {
            length: address.length,
            wordCount: address.split(/\s+/).length,
            commaCount: (address.match(/,/g) || []).length,
            postalCode: 0,
            region: 0,
            city: 0,
            street: 0,
            house: 0
        };
        
        // Проверяем паттерны
        Object.keys(this.patterns).forEach(key => {
            const pattern = this.patterns[key];
            const matches = address.match(pattern);
            if (matches) {
                features[key] = 1;
            }
        });
        
        return features;
    }
    
    calculateScore(features) {
        let score = 0;
        
        // Добавляем баллы за найденные компоненты
        if (features.postalCode) score += this.weights.postalCode;
        if (features.region) score += this.weights.region;
        if (features.city) score += this.weights.city;
        if (features.street) score += this.weights.street;
        if (features.house) score += this.weights.house;
        
        // Дополнительные баллы
        score += Math.min(features.commaCount * this.weights.commaCount, 0.15);
        
        if (features.length > 20) {
            score += this.weights.minLength;
        }
        
        // Штрафы
        if (features.wordCount < 3) {
            score -= 0.2;
        }
        
        if (features.length < 10) {
            score -= 0.3;
        }
        
        // Ограничиваем от 0 до 1
        return Math.max(0, Math.min(1, score));
    }
    
    predict(address) {
        const features = this.extractFeatures(address);
        const score = this.calculateScore(features);
        
        let quality, color;
        
        if (score > 0.75) {
            quality = "EXCELLENT";
            color = "#2ecc71"; // Зеленый
        } else if (score > 0.55) {
            quality = "GOOD";
            color = "#f39c12"; // Оранжевый
        } else if (score > 0.35) {
            quality = "MEDIUM";
            color = "#3498db"; // Синий
        } else {
            quality = "POOR";
            color = "#e74c3c"; // Красный
        }
        
        return {
            score: Math.round(score * 1000) / 1000,
            quality: quality,
            color: color,
            features: features
        };
    }
}

// Экспорт класса
window.AutonomousGeocoder = AutonomousGeocoder;
