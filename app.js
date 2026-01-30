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
            yandex: 0,
            nominatim: 0,
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
    
    normalizeRussianAddress(address, region = '') {
    if (!address) return '';
    
    let normalized = address.toString().trim();
    console.log(`📝 Исходный адрес: ${normalized}`);
    
    // Удаляем почтовые индексы
    normalized = normalized.replace(/^\d{6},?\s*/, '');
    normalized = normalized.replace(/,\s*\d{6}$/, '');
    
    // Обрабатываем скобки с населенными пунктами
    normalized = normalized.replace(/\(([^)]+)\)/g, (match, p1) => {
        // Если в скобках есть сокращения для населенных пунктов
        if (p1.includes('с)') || p1.includes('пгт)') || p1.includes('рп)') || p1.includes('д)')) {
            // Преобразуем "(с)" в "с."
            return p1.replace(/\s*\)$/, '').replace('(', '');
        }
        return p1.trim();
    });
    
    // Заменяем " (с)" на " с."
    normalized = normalized.replace(/\s*\(с\)/g, ' с.');
    normalized = normalized.replace(/\s*\(пгт\)/g, ' пгт.');
    normalized = normalized.replace(/\s*\(рп\)/g, ' рп.');
    normalized = normalized.replace(/\s*\(д\)/g, ' д.');
    
    // Убираем лишние слова
    const stopWords = [
        'торговая точка', 'торг\\s*точка', 'тт', 'магазин',
        'здание', 'помещ[ение]*', 'пом\\.?', 'влд\\.?\\s*\\d+',
        'владение\\s*\\d+', 'влад\\.?\\s*\\d+', 'корп\\.?\\s*\\d+',
        'строение\\s*\\d+', 'жилой комплекс', 'жк', 'микрорайон', 'мкр\\.?',
        'населенный пункт', 'нас\\.?\\s*пункт', 'нас\\.пункт'
    ];
    
    stopWords.forEach(pattern => {
        const regex = new RegExp(pattern, 'gi');
        normalized = normalized.replace(regex, '');
    });
    
    // Нормализуем сокращения
    const replacements = {
        'республика': 'Респ', 'область': 'обл', 'край': 'край',
        'город': 'г', 'поселок': 'п', 'село': 'с', 'деревня': 'д',
        'улица': 'ул', 'проспект': 'пр-кт', 'переулок': 'пер',
        'шоссе': 'ш', 'проезд': 'пр-д', 'площадь': 'пл',
        'поселок городского типа': 'пгт', 'рабочий поселок': 'рп',
        'район': 'р-н', 'микрорайон': 'мкр', 'бульвар': 'б-р'
    };
    
    Object.entries(replacements).forEach(([full, short]) => {
        const regex = new RegExp(`\\b${full}\\b`, 'gi');
        normalized = normalized.replace(regex, short);
    });
    
    // Очистка
    normalized = normalized.replace(/,\s*,/g, ',');
    normalized = normalized.replace(/\s+,\s*/g, ', ');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    normalized = normalized.replace(/\s*\/\s*/g, '/');
    
    // Обработка номера дома
    normalized = normalized.replace(/(\d+)\s*[\/\\]\s*(\d+)/g, '$1/$2');
    normalized = normalized.replace(/(\d+)\s+([а-яa-z])(?![а-яa-z])/gi, '$1$2');
    
    // Разделяем на части
    const parts = normalized.split(',').map(p => p.trim()).filter(p => p.length > 1);
    
    // Восстанавливаем правильный порядок
    const orderedParts = [];
    const regionKeywords = ['обл', 'край', 'респ', 'ао', 'область'];
    const settlementKeywords = ['г\\.', 'пгт\\.', 'рп\\.', 'с\\.', 'д\\.', 'п\\.'];
    const streetKeywords = ['ул\\.', 'пр-кт\\.', 'пер\\.', 'ш\\.', 'б-р\\.', 'пр-д\\.', 'пл\\.'];
    
    // Ищем регион
    const regionPart = parts.find(p => 
        regionKeywords.some(kw => p.toLowerCase().includes(kw.toLowerCase()))
    );
    if (regionPart) orderedParts.push(regionPart);
    
    // Ищем населенный пункт - улучшенная логика
    let settlementPart = null;
    for (const part of parts) {
        // Проверяем по ключевым словам
        if (settlementKeywords.some(kw => part.toLowerCase().startsWith(kw))) {
            settlementPart = part;
            break;
        }
        // Проверяем названия городов/сел без сокращений
        if (!regionKeywords.some(kw => part.toLowerCase().includes(kw)) &&
            !streetKeywords.some(kw => part.toLowerCase().includes(kw)) &&
            !/\d/.test(part) && 
            part.length > 2 && 
            part !== regionPart) {
            // Проверяем, не является ли это улицей
            const isStreet = streetKeywords.some(kw => 
                part.toLowerCase().includes(kw.replace('\\.', ''))
            );
            if (!isStreet) {
                settlementPart = part;
                // Добавляем сокращение если его нет
                if (!settlementPart.match(/^(г\.|с\.|п\.|пгт\.|рп\.|д\.)/i)) {
                    // Определяем тип по контексту
                    if (part.toLowerCase().includes('мамонтово')) {
                        settlementPart = 'с. ' + part.replace(' с.', '').replace('с.', '').trim();
                    }
                }
                break;
            }
        }
    }
    
    if (settlementPart && !orderedParts.includes(settlementPart)) {
        orderedParts.push(settlementPart);
    }
    
    // Ищем улицу
    const streetPart = parts.find(p => 
        streetKeywords.some(kw => p.toLowerCase().includes(kw))
    );
    if (streetPart && !orderedParts.includes(streetPart)) orderedParts.push(streetPart);
    
    // Ищем номер дома
    const housePart = parts.find(p => 
        /\d+/.test(p) && !orderedParts.includes(p) && 
        !settlementKeywords.some(kw => p.toLowerCase().includes(kw.replace('\\.', '')))
    );
    if (housePart) orderedParts.push(housePart);
    
    // Добавляем остальные части
    parts.forEach(part => {
        if (!orderedParts.includes(part) && part) {
            orderedParts.push(part);
        }
    });
    
    // Собираем обратно
    normalized = orderedParts.join(', ');
    
    // Добавляем Россию если нужно
    if (!normalized.toLowerCase().includes('россия') && 
        (normalized.toLowerCase().includes('обл') || 
         normalized.toLowerCase().includes('край') ||
         normalized.toLowerCase().includes('респ'))) {
        normalized = normalized + ', Россия';
    }
    
    console.log(`📝 Нормализованный адрес: ${normalized}`);
    return normalized.trim();
}
    
    getCacheKey(address, region = '') {
        const normalized = this.normalizeRussianAddress(address, region).toLowerCase();
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
        
        if (this.cache.size % 10 === 0) {
            this.saveCache();
        }
    }
    
    async geocodeYandex(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            const normalized = this.normalizeRussianAddress(address, region);
            
            if (!normalized || normalized.length < 3) {
                return null;
            }
            
            const cached = this.getFromCache(address, region);
            if (cached) {
                return cached;
            }
            
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.yandex || 800));
            
            const searchAddress = normalized.replace(/,\s*Россия$/i, '');
            const encoded = encodeURIComponent(searchAddress);
            const yandexUrl = `https://geocode-maps.yandex.ru/1.x/?format=json&geocode=${encoded}&results=1`;
            
            const proxyUrls = CONFIG.GEOCODING.proxy?.urls || [
                'https://api.allorigins.win/get?url='
            ];
            
            for (let i = 0; i < proxyUrls.length; i++) {
                const proxyUrl = proxyUrls[i];
                
                try {
                    const proxyFullUrl = proxyUrl.includes('allorigins.win') 
                        ? `${proxyUrl}${encodeURIComponent(yandexUrl)}`
                        : `${proxyUrl}${yandexUrl}`;
                    
                    console.log(`📍 Яндекс через прокси ${i+1}: ${searchAddress.substring(0, 60)}...`);
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    
                    const response = await fetch(proxyFullUrl, {
                        signal: controller.signal,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'application/json'
                        }
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (!response.ok) {
                        console.warn(`❌ Прокси ${i+1} ошибка ${response.status}`);
                        continue;
                    }
                    
                    let yandexData;
                    if (proxyUrl.includes('allorigins.win')) {
                        const data = await response.json();
                        yandexData = JSON.parse(data.contents);
                    } else {
                        yandexData = await response.json();
                    }
                    
                    if (yandexData.response?.GeoObjectCollection?.featureMember?.length > 0) {
                        const pos = yandexData.response.GeoObjectCollection.featureMember[0]
                            .GeoObject.Point.pos.split(' ');
                        
                        const lon = parseFloat(pos[0]);
                        const lat = parseFloat(pos[1]);
                        
                        // Проверяем, что координаты в пределах России
                        if (this.isValidCoordinateForRegion(lat, lon, region || address)) {
                            console.log(`✅ Яндекс нашел: ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
                            
                            this.stats.yandex++;
                            const result = {
                                lat: lat,
                                lng: lon,
                                source: 'yandex',
                                isExact: true,
                                normalized: normalized
                            };
                            
                            this.saveToCache(address, region, lat, lon, 'yandex', true);
                            return result;
                        } else {
                            console.warn(`❌ Координаты вне региона: ${lat}, ${lon}`);
                        }
                    }
                    
                } catch (proxyError) {
                    console.warn(`⚠️ Прокси ${i+1} не сработал:`, proxyError.message);
                    continue;
                }
            }
            
            console.log(`❌ Яндекс не нашел: ${searchAddress.substring(0, 50)}...`);
            return null;
            
        } catch (error) {
            console.warn('❌ Ошибка Яндекс:', error.message);
            return null;
        }
    }
    
    isValidCoordinateForRegion(lat, lng, region) {
        const regionBounds = {
            'Алтайский': { minLat: 49, maxLat: 54, minLng: 78, maxLng: 88 },
            'Архангельская': { minLat: 61, maxLat: 66, minLng: 37, maxLng: 48 },
            'Астраханская': { minLat: 45, maxLat: 48, minLng: 45, maxLng: 50 },
            'Белгородская': { minLat: 50, maxLat: 51, minLng: 35, maxLng: 39 },
            'Брянская': { minLat: 52, maxLat: 54, minLng: 31, maxLng: 35 },
            'Владимирская': { minLat: 55, maxLat: 57, minLng: 38, maxLng: 42 },
            'Волгоградская': { minLat: 48, maxLat: 51, minLng: 41, maxLng: 47 },
            'Вологодская': { minLat: 58, maxLat: 62, minLng: 35, maxLng: 46 },
            'Воронежская': { minLat: 49, maxLat: 52, minLng: 38, maxLng: 43 },
            'Еврейская': { minLat: 48, maxLat: 49, minLng: 130, maxLng: 135 },
            'Забайкальский': { minLat: 49, maxLat: 58, minLng: 108, maxLng: 122 },
            'Ивановская': { minLat: 56, maxLat: 58, minLng: 39, maxLng: 43 },
            'Иркутская': { minLat: 52, maxLat: 62, minLng: 96, maxLng: 119 },
            'Калининградская': { minLat: 54, maxLat: 55, minLng: 19, maxLng: 23 },
            'Калужская': { minLat: 53, maxLat: 55, minLng: 33, maxLng: 37 },
            'Камчатский': { minLat: 51, maxLat: 62, minLng: 155, maxLng: 174 },
            'Кемеровская': { minLat: 53, maxLat: 56, minLng: 84, maxLng: 89 },
            'Кировская': { minLat: 57, maxLat: 61, minLng: 46, maxLng: 54 },
            'Костромская': { minLat: 58, maxLat: 59, minLng: 40, maxLng: 47 },
            'Краснодарский': { minLat: 44, maxLat: 46, minLng: 37, maxLng: 41 },
            'Красноярский': { minLat: 53, maxLat: 70, minLng: 78, maxLng: 113 },
            'Курганская': { minLat: 54, maxLat: 56, minLng: 62, maxLng: 68 },
            'Курская': { minLat: 51, maxLat: 52, minLng: 34, maxLng: 38 },
            'Ленинградская': { minLat: 58, maxLat: 61, minLng: 28, maxLng: 35 },
            'Липецкая': { minLat: 52, maxLat: 53, minLng: 37, maxLng: 40 },
            'Магаданская': { minLat: 59, maxLat: 66, minLng: 146, maxLng: 162 },
            'Московская': { minLat: 54, maxLat: 57, minLng: 35, maxLng: 40 },
            'Мурманская': { minLat: 66, maxLat: 69, minLng: 28, maxLng: 41 },
            'Нижегородская': { minLat: 55, maxLat: 58, minLng: 42, maxLng: 48 },
            'Новгородская': { minLat: 57, maxLat: 59, minLng: 30, maxLng: 35 },
            'Новосибирская': { minLat: 53, maxLat: 57, minLng: 75, maxLng: 84 },
            'Омская': { minLat: 53, maxLat: 58, minLng: 70, maxLng: 76 },
            'Оренбургская': { minLat: 50, maxLat: 54, minLng: 50, maxLng: 62 },
            'Орловская': { minLat: 52, maxLat: 53, minLng: 35, maxLng: 38 },
            'Пензенская': { minLat: 52, maxLat: 54, minLng: 42, maxLng: 47 },
            'Пермский': { minLat: 56, maxLat: 61, minLng: 52, maxLng: 59 },
            'Приморский': { minLat: 42, maxLat: 48, minLng: 130, maxLng: 139 },
            'Псковская': { minLat: 56, maxLat: 58, minLng: 27, maxLng: 31 },
            'Ростовская': { minLat: 46, maxLat: 50, minLng: 38, maxLng: 44 },
            'Рязанская': { minLat: 53, maxLat: 55, minLng: 38, maxLng: 42 },
            'Самарская': { minLat: 52, maxLat: 54, minLng: 48, maxLng: 52 },
            'Саратовская': { minLat: 50, maxLat: 53, minLng: 42, maxLng: 50 },
            'Сахалинская': { minLat: 46, maxLat: 54, minLng: 142, maxLng: 145 },
            'Свердловская': { minLat: 56, maxLat: 60, minLng: 57, maxLng: 66 },
            'Смоленская': { minLat: 54, maxLat: 56, minLng: 31, maxLng: 35 },
            'Тамбовская': { minLat: 52, maxLat: 53, minLng: 40, maxLng: 43 },
            'Тверская': { minLat: 55, maxLat: 58, minLng: 31, maxLng: 38 },
            'Томская': { minLat: 56, maxLat: 59, minLng: 75, maxLng: 89 },
            'Тульская': { minLat: 53, maxLat: 55, minLng: 35, maxLng: 39 },
            'Тюменская': { minLat: 55, maxLat: 59, minLng: 65, maxLng: 75 },
            'Удмуртская': { minLat: 56, maxLat: 58, minLng: 51, maxLng: 54 },
            'Ульяновская': { minLat: 53, maxLat: 55, minLng: 46, maxLng: 49 },
            'Хабаровский': { minLat: 47, maxLat: 54, minLng: 130, maxLng: 140 },
            'Ханты-Мансийский': { minLat: 59, maxLat: 65, minLng: 61, maxLng: 85 },
            'Челябинская': { minLat: 53, maxLat: 56, minLng: 57, maxLng: 62 },
            'Чеченская': { minLat: 43, maxLat: 44, minLng: 45, maxLng: 46 },
            'Чувашская': { minLat: 54, maxLat: 56, minLng: 45, maxLng: 48 },
            'Ямало-Ненецкий': { minLat: 64, maxLat: 70, minLng: 64, maxLng: 84 },
            'Ярославская': { minLat: 57, maxLat: 58, minLng: 38, maxLng: 43 },
            'Москва': { minLat: 55, maxLat: 56, minLng: 37, maxLng: 38 },
            'Санкт-Петербург': { minLat: 59, maxLat: 60, minLng: 30, maxLng: 31 },
            'Севастополь': { minLat: 44, maxLat: 45, minLng: 33, maxLng: 34 },
            'Байконур': { minLat: 45, maxLat: 46, minLng: 63, maxLng: 64 }
        };
        
        for (const [key, bounds] of Object.entries(regionBounds)) {
            if (region && region.includes(key)) {
                console.log(`🗺️  Проверка региона ${key}: ${lat}∈[${bounds.minLat},${bounds.maxLat}], ${lng}∈[${bounds.minLng},${bounds.maxLng}]`);
                return lat >= bounds.minLat && lat <= bounds.maxLat && 
                       lng >= bounds.minLng && lng <= bounds.maxLng;
            }
        }
        
        // Общая проверка для России
        const inRussia = lat >= 41 && lat <= 82 && lng >= 19 && lng <= 180;
        console.log(`🗺️  Общая проверка России: ${inRussia ? 'OK' : 'FAIL'}`);
        return inRussia;
    }
    
    async geocodeNominatim(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            let normalized = this.normalizeRussianAddress(address, region);
            normalized = normalized.replace(/,\s*Россия$/i, '');
            
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.nominatim || 2000));
            
            const queries = this.generateOSMQueries(normalized, region);
            console.log(`🌍 OSM запросы для "${normalized}":`, queries);
            
            for (const query of queries) {
                try {
                    console.log(`🌍 OSM запрос: ${query.substring(0, 80)}...`);
                    const result = await this.queryNominatim(query);
                    
                    if (result) {
                        // Проверяем, что координаты в пределах региона
                        if (this.isValidCoordinateForRegion(result.lat, result.lng, region || address)) {
                            console.log(`✅ OSM нашел по запросу: ${query.substring(0, 60)}...`);
                            return {
                                ...result,
                                normalized: normalized
                            };
                        } else {
                            console.warn(`❌ OSM результат вне региона: ${result.lat}, ${result.lng}`);
                        }
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
    
    generateOSMQueries(address, region = '') {
    const queries = new Set();
    const parts = address.split(',').map(p => p.trim()).filter(p => p.length > 1);
    
    console.log(`🔍 Части адреса:`, parts);
    
    // Удаляем "Россия" из адреса для OSM
    let addressWithoutRussia = address.replace(/,\s*Россия$/i, '').trim();
    if (addressWithoutRussia.length > 10) {
        queries.add(addressWithoutRussia);
    }
    
    // Ищем ключевые части адреса
    const regionPart = parts.find(p => 
        p.toLowerCase().includes('обл') || 
        p.toLowerCase().includes('край') || 
        p.toLowerCase().includes('респ')
    );
    
    // Улучшенное определение населенного пункта
    let settlementPart = null;
    for (const part of parts) {
        // Проверяем стандартные сокращения
        if (part.match(/^(г\.|с\.|п\.|пгт\.|рп\.|д\.)/i)) {
            settlementPart = part;
            break;
        }
        // Проверяем названия без сокращений
        if (part.length > 2 && 
            !part.includes('обл') && 
            !part.includes('край') && 
            !part.includes('ул') && 
            !part.includes('пр-кт') &&
            !part.includes('пер') &&
            !/\d/.test(part) &&
            part !== regionPart) {
            
            // Проверяем, не является ли это известным городом/селом
            const knownSettlements = ['мамонтово', 'барнаул', 'новосибирск', 'красноярск'];
            if (knownSettlements.some(s => part.toLowerCase().includes(s))) {
                settlementPart = part;
                // Если нет сокращения, добавляем его
                if (!settlementPart.match(/^(г\.|с\.|п\.)/i)) {
                    if (part.toLowerCase().includes('мамонтово')) {
                        settlementPart = 'с. ' + part;
                    } else {
                        settlementPart = 'г. ' + part;
                    }
                }
                break;
            }
        }
    }
    
    const streetPart = parts.find(p => 
        p.match(/^(ул\.|пр-кт\.|пер\.|ш\.|пр-д\.|пл\.|б-р\.)/i)
    );
    
    const housePart = parts.find(p => 
        /\d+/.test(p) && 
        !p.match(/^(г\.|с\.|ул\.|пр-кт\.|пер\.)/i) &&
        !p.toLowerCase().includes('обл') &&
        !p.toLowerCase().includes('край')
    );
    
    console.log(`🔍 Ключевые части:`, { regionPart, settlementPart, streetPart, housePart });
    
    // Собираем осмысленные комбинации
    if (settlementPart && streetPart && housePart) {
        // Населенный пункт + улица + дом (самый вероятный)
        queries.add([settlementPart, streetPart, housePart].join(', '));
        
        // Если есть регион
        if (regionPart) {
            queries.add([regionPart, settlementPart, streetPart, housePart].join(', '));
        }
    }
    
    if (settlementPart && streetPart) {
        // Населенный пункт + улица
        queries.add([settlementPart, streetPart].join(', '));
        queries.add([streetPart, settlementPart].join(', '));
        
        if (regionPart) {
            queries.add([regionPart, settlementPart, streetPart].join(', '));
        }
    }
    
    if (settlementPart && housePart) {
        // Населенный пункт + дом
        queries.add([settlementPart, housePart].join(', '));
    }
    
    if (streetPart && housePart) {
        // Улица + дом
        queries.add([streetPart, housePart].join(', '));
    }
    
    // Только населенный пункт
    if (settlementPart) {
        queries.add(settlementPart);
        
        // Населенный пункт + регион
        if (regionPart) {
            queries.add([regionPart, settlementPart].join(', '));
        }
    }
    
    // Только улица
    if (streetPart) {
        queries.add(streetPart);
    }
    
    // Если есть номер дома отдельно
    if (housePart && housePart.length > 1) {
        queries.add(housePart);
    }
    
    // Удаляем дубликаты и фильтруем
    const filteredQueries = Array.from(queries)
        .filter(q => q && q.length > 3 && q.length < 200)
        .slice(0, 8); // Ограничиваем количество запросов
    
    console.log(`🌍 Сгенерированные OSM запросы:`, filteredQueries);
    return filteredQueries;
}
    
    async queryNominatim(query) {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1&countrycodes=ru&accept-language=ru&addressdetails=1`;
    
    console.log(`🌍 OSM запрос: ${query.substring(0, 80)}...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // Уменьшили таймаут
    
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': CONFIG.GEOCODING.osmUserAgent || 'TTMapApp/1.0',
                'Accept': 'application/json',
                'Referer': window.location.origin || 'https://tt-map-app.example.com'
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
                
                this.stats.nominatim++;
                return {
                    lat: lat,
                    lng: lon,
                    source: 'nominatim',
                    isExact: true,
                    displayName: item.display_name || ''
                };
            }
        } else if (response.status === 503 || response.status === 504) {
            console.warn(`⚠️ OSM временно недоступен (${response.status})`);
            throw new Error('OSM service unavailable');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.warn('⏰ Таймаут OSM запроса');
        } else if (error.message === 'OSM service unavailable') {
            throw error; // Перебрасываем дальше
        } else {
            console.warn('⚠️ Ошибка OSM запроса:', error.message);
        }
        throw error;
    }
    
    return null;
}
    
    async geocodeOverpassAPI(address, region = '') {
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
            const timeoutId = setTimeout(() => controller.abort(), 20000);
            
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
    
    // Удаляем "Россия" и прочее
    const cleanAddress = address.replace(/,\s*Россия$/i, '');
    
    // Ищем населенный пункт после региона
    const parts = cleanAddress.split(',').map(p => p.trim());
    
    for (const part of parts) {
        // Проверяем сокращения
        if (part.match(/^(г\.|с\.|п\.|пгт\.|рп\.|д\.)/i)) {
            const name = part.replace(/^(г\.|с\.|п\.|пгт\.|рп\.|д\.)\s*/i, '').trim();
            if (name.length > 2) return name;
        }
        
        // Проверяем названия городов без сокращений
        const knownSettlements = [
            'мамонтово', 'барнаул', 'новосибирск', 'красноярск', 
            'омск', 'томск', 'кемерово', 'новокузнецк'
        ];
        
        for (const settlement of knownSettlements) {
            if (part.toLowerCase().includes(settlement)) {
                // Ищем слово целиком
                const words = part.split(/\s+/);
                for (const word of words) {
                    if (word.toLowerCase() === settlement && word.length > 2) {
                        return word;
                    }
                }
                return settlement;
            }
        }
    }
    
    // Если не нашли, берем первое слово после региона
    const regionIndex = parts.findIndex(p => 
        p.includes('обл') || p.includes('край') || p.includes('Респ')
    );
    
    if (regionIndex !== -1 && parts.length > regionIndex + 1) {
        const nextPart = parts[regionIndex + 1];
        // Проверяем, что это не улица
        if (!nextPart.match(/^(ул\.|пр-кт\.|пер\.)/i) && !/\d/.test(nextPart)) {
            return nextPart.replace(/^(г\.|с\.|п\.)\s*/i, '').trim();
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
        
        const cached = this.getFromCache(address, region);
        if (cached) {
            return cached;
        }
        
        const normalized = this.normalizeRussianAddress(address, region);
        
        // Новый порядок: сначала OSM, потом Яндекс, потом Overpass
        const serviceOrder = [
            { name: 'nominatim', func: () => this.geocodeNominatim(address, region) },
            { name: 'yandex', func: () => this.geocodeYandex(address, region) },
            { name: 'overpass', func: () => this.geocodeOverpassAPI(address, region) }
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
        
        if (result && result.isExact) {
            this.saveToCache(address, region, result.lat, result.lng, usedService, true);
            
            if (pointId) {
                this.updatePointAndMarker(pointId, result.lat, result.lng, usedService);
            }
            
            return result;
        }
        
        if (result && !result.isExact) {
            this.stats.approximate++;
            this.saveToCache(address, region, result.lat, result.lng, usedService, false);
            return result;
        }
        
        this.stats.failed++;
        const approximate = this.getApproximateCoordinates(address, region);
        this.saveToCache(address, region, approximate.lat, approximate.lng, 'approximate', false);
        
        return approximate;
    }
    
    getApproximateCoordinates(address, region = '') {
        const regionCoords = {
            'Москва': { lat: 55.7558, lng: 37.6173, radius: 0.03 },
            'Московская': { lat: 55.7558, lng: 37.6173, radius: 0.2 },
            'Санкт-Петербург': { lat: 59.9343, lng: 30.3351, radius: 0.03 },
            'Ленинградская': { lat: 59.9343, lng: 30.3351, radius: 0.2 },
            'Алтайский': { lat: 53.3481, lng: 83.7794, radius: 0.3 },
            'Краснодарский': { lat: 45.0355, lng: 38.9753, radius: 0.2 },
            'Свердловская': { lat: 56.8389, lng: 60.6057, radius: 0.2 },
            'Ростовская': { lat: 47.2224, lng: 39.7189, radius: 0.2 },
            'Татарстан': { lat: 55.7961, lng: 49.1064, radius: 0.2 },
            'Челябинская': { lat: 55.1644, lng: 61.4368, radius: 0.2 },
            'Архангельская': { lat: 64.5393, lng: 40.5187, radius: 0.5 },
            'Астраханская': { lat: 46.3479, lng: 48.0336, radius: 0.3 },
            'Белгородская': { lat: 50.5952, lng: 36.5872, radius: 0.2 },
            'Брянская': { lat: 53.2434, lng: 34.3642, radius: 0.2 },
            'Владимирская': { lat: 56.1290, lng: 40.4070, radius: 0.2 },
            'default': { lat: 55.7558, lng: 37.6173, radius: 2.0 }
        };
        
        let baseLat = 55.7558;
        let baseLng = 37.6173;
        let radius = 2.0;
        
        const searchText = (region || address || '').toLowerCase();
        
        for (const [key, coords] of Object.entries(regionCoords)) {
            if (searchText.includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                radius = coords.radius;
                console.log(`📍 Приблизительные координаты для региона ${key}`);
                break;
            }
        }
        
        // Добавляем случайное смещение в пределах региона
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
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
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
        console.log(`   Яндекс: ${this.stats.yandex}`);
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
        
        // Сохраняем оригинальный адрес
        point.originalAddress = point.address || '';
        
        // Нормализуем адрес через geocodingSystem если он инициализирован
        if (point.address && geocodingSystem) {
            point.address = geocodingSystem.normalizeRussianAddress(point.address, point.region);
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

