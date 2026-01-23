// ============================================================================
// АВТОНОМНЫЙ ГЕОКОДЕР ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ
// Работает без API ключей, использует открытые источники
// ============================================================================

class AutonomousGeocoder {
    constructor() {
        this.cache = {};
        this.localDB = this._initLocalDB();
        this.regionalDB = this._initRegionalDB();
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
            "ростов-на-дону пр1-кт стачки": { lat: 47.2214, lng: 39.7114 },
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

    // Инициализация базы координат по регионам
    _initRegionalDB() {
        return {
            // Федеральные округа и регионы РФ
            'москва': { lat: 55.7558, lng: 37.6173, radius: 0.2 },
            'московская область': { lat: 55.7539, lng: 37.6208, radius: 1.0 },
            'московская обл': { lat: 55.7539, lng: 37.6208, radius: 1.0 },
            'московская': { lat: 55.7539, lng: 37.6208, radius: 1.0 },
            
            'санкт-петербург': { lat: 59.9343, lng: 30.3351, radius: 0.2 },
            'ленинградская область': { lat: 59.9391, lng: 30.3159, radius: 1.5 },
            'ленинградская обл': { lat: 59.9391, lng: 30.3159, radius: 1.5 },
            
            'алтайский край': { lat: 53.3606, lng: 83.7636, radius: 2.0 },
            'алтайский': { lat: 53.3606, lng: 83.7636, radius: 2.0 },
            'алтай': { lat: 53.3606, lng: 83.7636, radius: 2.0 },
            
            'краснодарский край': { lat: 45.0355, lng: 38.9753, radius: 1.5 },
            'краснодарский': { lat: 45.0355, lng: 38.9753, radius: 1.5 },
            
            'свердловская область': { lat: 56.8389, lng: 60.6057, radius: 1.5 },
            'свердловская': { lat: 56.8389, lng: 60.6057, radius: 1.5 },
            'екатеринбург': { lat: 56.8389, lng: 60.6057, radius: 0.5 },
            
            'татарстан': { lat: 55.7961, lng: 49.1064, radius: 1.5 },
            'республика татарстан': { lat: 55.7961, lng: 49.1064, radius: 1.5 },
            
            'башкортостан': { lat: 54.7351, lng: 55.9587, radius: 2.0 },
            'республика башкортостан': { lat: 54.7351, lng: 55.9587, radius: 2.0 },
            
            'нижегородская область': { lat: 56.3269, lng: 44.0065, radius: 1.5 },
            'нижегородская': { lat: 56.3269, lng: 44.0065, radius: 1.5 },
            
            'челябинская область': { lat: 55.1644, lng: 61.4368, radius: 1.5 },
            'челябинская': { lat: 55.1644, lng: 61.4368, radius: 1.5 },
            
            'самарская область': { lat: 53.2415, lng: 50.2212, radius: 1.5 },
            'самарская': { lat: 53.2415, lng: 50.2212, radius: 1.5 },
            
            'ростовская область': { lat: 47.2357, lng: 39.7015, radius: 1.5 },
            'ростовская': { lat: 47.2357, lng: 39.7015, radius: 1.5 },
            
            'красноярский край': { lat: 56.0090, lng: 92.8726, radius: 3.0 },
            'красноярский': { lat: 56.0090, lng: 92.8726, radius: 3.0 },
            
            'пермский край': { lat: 58.0105, lng: 56.2294, radius: 1.5 },
            'пермский': { lat: 58.0105, lng: 56.2294, radius: 1.5 },
            
            'воронежская область': { lat: 51.6606, lng: 39.2006, radius: 1.5 },
            'воронежская': { lat: 51.6606, lng: 39.2006, radius: 1.5 },
            
            'волгоградская область': { lat: 48.7071, lng: 44.5170, radius: 1.5 },
            'волгоградская': { lat: 48.7071, lng: 44.5170, radius: 1.5 },
            
            'тюменская область': { lat: 57.1530, lng: 65.5343, radius: 2.0 },
            'тюменская': { lat: 57.1530, lng: 65.5343, radius: 2.0 },
            
            'иркутская область': { lat: 52.2896, lng: 104.2806, radius: 2.0 },
            'иркутская': { lat: 52.2896, lng: 104.2806, radius: 2.0 },
            
            'хабаровский край': { lat: 48.4802, lng: 135.0719, radius: 2.5 },
            'хабаровский': { lat: 48.4802, lng: 135.0719, radius: 2.5 },
            
            'приморский край': { lat: 43.1155, lng: 131.8855, radius: 1.5 },
            'приморский': { lat: 43.1155, lng: 131.8855, radius: 1.5 },
            
            'тверская область': { lat: 56.8587, lng: 35.9176, radius: 1.5 },
            'тверская': { lat: 56.8587, lng: 35.9176, radius: 1.5 },
            
            'ярославская область': { lat: 57.6261, lng: 39.8845, radius: 1.5 },
            'ярославская': { lat: 57.6261, lng: 39.8845, radius: 1.5 },
            
            'ивановская область': { lat: 57.0004, lng: 40.9739, radius: 1.5 },
            'ивановская': { lat: 57.0004, lng: 40.9739, radius: 1.5 },
            
            'брянская область': { lat: 53.2436, lng: 34.3642, radius: 1.5 },
            'брянская': { lat: 53.2436, lng: 34.3642, radius: 1.5 },
            
            'курская область': { lat: 51.7304, lng: 36.1926, radius: 1.5 },
            'курская': { lat: 51.7304, lng: 36.1926, radius: 1.5 },
            
            'липецкая область': { lat: 52.6088, lng: 39.5992, radius: 1.5 },
            'липецкая': { lat: 52.6088, lng: 39.5992, radius: 1.5 },
            
            'оренбургская область': { lat: 51.7682, lng: 55.0974, radius: 1.5 },
            'оренбургская': { lat: 51.7682, lng: 55.0974, radius: 1.5 },
            
            'пензенская область': { lat: 53.2001, lng: 45.0047, radius: 1.5 },
            'пензенская': { lat: 53.2001, lng: 45.0047, radius: 1.5 },
            
            'астраханская область': { lat: 46.3497, lng: 48.0408, radius: 1.5 },
            'астраханская': { lat: 46.3497, lng: 48.0408, radius: 1.5 },
            
            'дагестан': { lat: 42.9831, lng: 47.5047, radius: 1.5 },
            'республика дагестан': { lat: 42.9831, lng: 47.5047, radius: 1.5 },
            
            'калининградская область': { lat: 54.7104, lng: 20.4522, radius: 0.5 },
            'калининградская': { lat: 54.7104, lng: 20.4522, radius: 0.5 },
            
            'крым': { lat: 45.0433, lng: 34.6021, radius: 1.0 },
            'республика крым': { lat: 45.0433, lng: 34.6021, radius: 1.0 },
            
            'севастополь': { lat: 44.6166, lng: 33.5254, radius: 0.3 },
            
            // Центральный федеральный округ
            'белгородская': { lat: 50.5953, lng: 36.5873, radius: 1.5 },
            'владимирская': { lat: 56.1290, lng: 40.4066, radius: 1.5 },
            'воронежская': { lat: 51.6606, lng: 39.2006, radius: 1.5 },
            'ивановская': { lat: 57.0004, lng: 40.9739, radius: 1.5 },
            'калужская': { lat: 54.5140, lng: 36.2616, radius: 1.5 },
            'костромская': { lat: 57.7660, lng: 40.9269, radius: 1.5 },
            'курская': { lat: 51.7304, lng: 36.1926, radius: 1.5 },
            'липецкая': { lat: 52.6088, lng: 39.5992, radius: 1.5 },
            'московская': { lat: 55.7539, lng: 37.6208, radius: 1.0 },
            'орловская': { lat: 52.9704, lng: 36.0642, radius: 1.5 },
            'рязанская': { lat: 54.6294, lng: 39.7417, radius: 1.5 },
            'смоленская': { lat: 54.7826, lng: 32.0453, radius: 1.5 },
            'тамбовская': { lat: 52.7212, lng: 41.4523, radius: 1.5 },
            'тверская': { lat: 56.8587, lng: 35.9176, radius: 1.5 },
            'тульская': { lat: 54.1930, lng: 37.6173, radius: 1.5 },
            'ярославская': { lat: 57.6261, lng: 39.8845, radius: 1.5 },
            
            // Северо-Западный федеральный округ
            'архангельская': { lat: 64.5401, lng: 40.5433, radius: 2.0 },
            'вологодская': { lat: 59.2181, lng: 39.8964, radius: 1.5 },
            'калининградская': { lat: 54.7104, lng: 20.4522, radius: 0.5 },
            'карелия': { lat: 61.7850, lng: 34.3469, radius: 2.0 },
            'коми': { lat: 61.6688, lng: 50.8354, radius: 2.0 },
            'ленинградская': { lat: 59.9391, lng: 30.3159, radius: 1.5 },
            'мурманская': { lat: 68.9585, lng: 33.0827, radius: 1.5 },
            'ненецкий': { lat: 67.6381, lng: 53.0069, radius: 3.0 },
            'новгородская': { lat: 58.5228, lng: 31.2699, radius: 1.5 },
            'псковская': { lat: 57.8194, lng: 28.3318, radius: 1.5 },
            
            // Южный федеральный округ
            'адыгея': { lat: 44.6089, lng: 40.1004, radius: 0.5 },
            'астраханская': { lat: 46.3497, lng: 48.0408, radius: 1.5 },
            'волгоградская': { lat: 48.7071, lng: 44.5170, radius: 1.5 },
            'калмыкия': { lat: 46.3080, lng: 44.2700, radius: 1.5 },
            'краснодарский': { lat: 45.0355, lng: 38.9753, radius: 1.5 },
            'крым': { lat: 45.0433, lng: 34.6021, radius: 1.0 },
            'ростовская': { lat: 47.2357, lng: 39.7015, radius: 1.5 },
            
            // Северо-Кавказский федеральный округ
            'дагестан': { lat: 42.9831, lng: 47.5047, radius: 1.5 },
            'ингушетия': { lat: 43.1155, lng: 44.6898, radius: 0.5 },
            'кабардино-балкария': { lat: 43.4853, lng: 43.6071, radius: 0.8 },
            'карачаево-черкесия': { lat: 43.9200, lng: 41.7931, radius: 0.8 },
            'осетия': { lat: 43.0246, lng: 44.6819, radius: 0.5 },
            'ставропольский': { lat: 45.0433, lng: 41.9691, radius: 1.5 },
            'чечня': { lat: 43.3189, lng: 45.6861, radius: 0.8 },
            
            // Приволжский федеральный округ
            'башкортостан': { lat: 54.7351, lng: 55.9587, radius: 2.0 },
            'кировская': { lat: 58.6035, lng: 49.6680, radius: 1.5 },
            'марий эл': { lat: 56.6389, lng: 47.8904, radius: 1.0 },
            'мордовия': { lat: 54.1808, lng: 45.1864, radius: 1.0 },
            'нижегородская': { lat: 56.3269, lng: 44.0065, radius: 1.5 },
            'оренбургская': { lat: 51.7682, lng: 55.0974, radius: 1.5 },
            'пензенская': { lat: 53.2001, lng: 45.0047, radius: 1.5 },
            'пермский': { lat: 58.0105, lng: 56.2294, radius: 1.5 },
            'самарская': { lat: 53.2415, lng: 50.2212, radius: 1.5 },
            'саратовская': { lat: 51.5924, lng: 45.9608, radius: 1.5 },
            'татарстан': { lat: 55.7961, lng: 49.1064, radius: 1.5 },
            'удмуртия': { lat: 56.8527, lng: 53.2115, radius: 1.5 },
            'ульяновская': { lat: 54.3142, lng: 48.4031, radius: 1.5 },
            'чувашия': { lat: 56.1463, lng: 47.2511, radius: 1.0 },
            
            // Уральский федеральный округ
            'курганская': { lat: 55.4422, lng: 65.3428, radius: 1.5 },
            'свердловская': { lat: 56.8389, lng: 60.6057, radius: 1.5 },
            'тюменская': { lat: 57.1530, lng: 65.5343, radius: 2.0 },
            'ханты-мансийский': { lat: 61.0032, lng: 69.0189, radius: 3.0 },
            'челябинская': { lat: 55.1644, lng: 61.4368, radius: 1.5 },
            'ямало-ненецкий': { lat: 66.5302, lng: 66.6136, radius: 4.0 },
            
            // Сибирский федеральный округ
            'алтай': { lat: 53.3606, lng: 83.7636, radius: 2.0 },
            'алтайский': { lat: 53.3606, lng: 83.7636, radius: 2.0 },
            'бурятия': { lat: 51.8345, lng: 107.5846, radius: 2.0 },
            'забайкальский': { lat: 52.0333, lng: 113.5000, radius: 2.5 },
            'иркутская': { lat: 52.2896, lng: 104.2806, radius: 2.0 },
            'кемеровская': { lat: 55.3547, lng: 86.0873, radius: 1.5 },
            'красноярский': { lat: 56.0090, lng: 92.8726, radius: 3.0 },
            'новосибирская': { lat: 55.0084, lng: 82.9357, radius: 1.5 },
            'омская': { lat: 54.9893, lng: 73.3682, radius: 1.5 },
            'томская': { lat: 56.4846, lng: 84.9476, radius: 1.5 },
            'тыва': { lat: 51.7191, lng: 94.4378, radius: 1.5 },
            'хакасия': { lat: 53.7223, lng: 91.4439, radius: 1.0 },
            
            // Дальневосточный федеральный округ
            'амурская': { lat: 50.2901, lng: 127.5272, radius: 2.0 },
            'еврейская': { lat: 48.4802, lng: 132.0739, radius: 1.5 },
            'камчатский': { lat: 53.0375, lng: 158.6559, radius: 2.0 },
            'магаданская': { lat: 59.5602, lng: 150.7986, radius: 2.0 },
            'приморский': { lat: 43.1155, lng: 131.8855, radius: 1.5 },
            'сахалинская': { lat: 46.9591, lng: 142.7380, radius: 1.5 },
            'хабаровский': { lat: 48.4802, lng: 135.0719, radius: 2.5 },
            'чукотский': { lat: 66.0000, lng: 169.5000, radius: 5.0 },
            'якутия': { lat: 62.0278, lng: 129.7322, radius: 4.0 },
            
            // Запасной вариант
            'default': { lat: 55.7558, lng: 37.6173, radius: 5.0 }
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
            .replace(/р-н/g, 'район')
            .replace(/\s+/g, ' ')
            .trim();
        
        return normalized;
    }

    // Нормализация региона
    normalizeRegion(region) {
        if (!region) return "";
        
        let normalized = region.toLowerCase()
            .replace(/область/g, '')
            .replace(/обл/g, '')
            .replace(/край/g, '')
            .replace(/республика/g, '')
            .replace(/респ/g, '')
            .replace(/автономный округ/g, '')
            .replace(/ао/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        return normalized;
    }

    // Получение координат региона
    getRegionCoordinates(region) {
        if (!region) return null;
        
        const normalizedRegion = this.normalizeRegion(region);
        
        // Прямой поиск по базе регионов
        for (const [regionName, data] of Object.entries(this.regionalDB)) {
            if (regionName.includes(normalizedRegion) || normalizedRegion.includes(regionName)) {
                return data;
            }
        }
        
        // Расширенный поиск с вариантами
        const searchVariants = [
            normalizedRegion,
            normalizedRegion + ' область',
            normalizedRegion + ' обл',
            normalizedRegion + ' край',
            'республика ' + normalizedRegion,
            normalizedRegion + ' республика',
            normalizedRegion + ' автономный округ'
        ];
        
        for (const variant of searchVariants) {
            if (this.regionalDB[variant]) {
                return this.regionalDB[variant];
            }
        }
        
        // Поиск по частичному совпадению
        for (const [regionName, data] of Object.entries(this.regionalDB)) {
            if (regionName.includes(normalizedRegion.substring(0, 4)) || 
                normalizedRegion.includes(regionName.substring(0, 4))) {
                return data;
            }
        }
        
        return this.regionalDB['default'];
    }

    // Геокодирование с использованием региона
    async geocodeWithRegion(address, region = '', city = '') {
        const startTime = Date.now();
        const normalizedAddress = this.normalizeAddress(address);
        const cacheKey = `geocode_${normalizedAddress}_${region}`;
        
        // 1. Проверяем кэш
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            console.log(`⚡ Кэш: ${Date.now() - startTime}ms`);
            return cached;
        }
        
        // 2. Получаем координаты региона
        const regionData = this.getRegionCoordinates(region);
        const regionCoords = regionData ? { lat: regionData.lat, lng: regionData.lng, radius: regionData.radius } : null;
        
        // 3. Пробуем локальную базу
        const localResult = this.geocodeLocal(address);
        if (localResult) {
            this.saveToCache(cacheKey, localResult);
            console.log(`⚡ Локальная база: ${Date.now() - startTime}ms`);
            return localResult;
        }
        
        // 4. Используем регион для уточненного поиска
        if (regionCoords) {
            // Пробуем геокодирование с указанием региона
            const regionAwareResult = await this.geocodeWithRegionAware(address, region, regionCoords);
            if (regionAwareResult) {
                this.saveToCache(cacheKey, regionAwareResult);
                console.log(`🌍 Геокодирование с регионом: ${Date.now() - startTime}ms`);
                return regionAwareResult;
            }
        }
        
        // 5. Если ничего не нашли, возвращаем координаты региона
        if (regionCoords) {
            // Генерируем случайные координаты в пределах региона
            const randomCoords = this.generateRandomInRegion(regionCoords);
            const result = {
                lat: randomCoords.lat,
                lng: randomCoords.lng,
                address: address,
                source: `Regional: ${region}`,
                precision: 'low',
                isApproximate: true,
                regionBased: true
            };
            
            this.saveToCache(cacheKey, result);
            console.log(`📍 Региональные координаты: ${Date.now() - startTime}ms`);
            return result;
        }
        
        return null;
    }

    // Генерация случайных координат в пределах региона
    generateRandomInRegion(regionCoords) {
        const radius = regionCoords.radius || 1.0;
        const randomRadius = Math.random() * radius;
        const randomAngle = Math.random() * 2 * Math.PI;
        
        // Переводим в градусы (1 градус ≈ 111 км)
        const deltaLat = randomRadius * Math.cos(randomAngle) / 111;
        const deltaLng = randomRadius * Math.sin(randomAngle) / (111 * Math.cos(regionCoords.lat * Math.PI / 180));
        
        return {
            lat: regionCoords.lat + deltaLat,
            lng: regionCoords.lng + deltaLng
        };
    }

    // Геокодирование с учетом региона
    async geocodeWithRegionAware(address, region, regionCoords) {
        try {
            // Создаем расширенный запрос с регионом
            let searchQuery = address;
            if (region) {
                searchQuery = `${address}, ${region}`;
            }
            
            // Пробуем Nominatim с регионом
            const nominatimResult = await this.geocodeNominatim(searchQuery);
            if (nominatimResult) {
                // Проверяем, что результат в пределах региона (если есть координаты региона)
                if (regionCoords && this.isWithinRegion(nominatimResult, regionCoords)) {
                    nominatimResult.regionBased = true;
                    return nominatimResult;
                }
            }
            
            // Пробуем Яндекс с регионом
            const yandexResult = await this.geocodeYandex(searchQuery);
            if (yandexResult) {
                if (regionCoords && this.isWithinRegion(yandexResult, regionCoords)) {
                    yandexResult.regionBased = true;
                    return yandexResult;
                }
            }
            
            // Пробуем 2GIS с регионом
            const gisResult = await this.geocode2GIS(searchQuery);
            if (gisResult) {
                if (regionCoords && this.isWithinRegion(gisResult, regionCoords)) {
                    gisResult.regionBased = true;
                    return gisResult;
                }
            }
            
        } catch (error) {
            console.warn('Ошибка геокодирования с регионом:', error);
        }
        
        return null;
    }

    // Проверка, находятся ли координаты в пределах региона
    isWithinRegion(coords, regionCoords) {
        if (!regionCoords || !coords) return true;
        
        const radius = regionCoords.radius || 2.0;
        const latDiff = Math.abs(coords.lat - regionCoords.lat);
        const lngDiff = Math.abs(coords.lng - regionCoords.lng);
        
        // Простая проверка (1 градус ≈ 111 км)
        return (latDiff * 111) <= radius && (lngDiff * 111 * Math.cos(regionCoords.lat * Math.PI / 180)) <= radius;
    }

    // Проверка кэша
    getFromCache(key) {
        // Проверяем быстрый кэш
        if (this.quickCache.has(key)) {
            return this.quickCache.get(key);
        }
        
        // Проверяем localStorage
        const cached = localStorage.getItem(key);
        
        if (cached) {
            try {
                const data = JSON.parse(cached);
                // Кэш на 90 дней
                if (Date.now() - data.timestamp < 90 * 24 * 60 * 60 * 1000) {
                    this.quickCache.set(key, data.result);
                    return data.result;
                }
            } catch (e) {
                localStorage.removeItem(key);
            }
        }
        
        return null;
    }

    // Сохранение в кэш
    saveToCache(key, result) {
        const cacheData = {
            result: result,
            timestamp: Date.now()
        };
        
        try {
            this.quickCache.set(key, result);
            localStorage.setItem(key, JSON.stringify(cacheData));
        } catch (e) {
            this._cleanupCache();
            localStorage.setItem(key, JSON.stringify(cacheData));
        }
    }

    // Геокодирование через Nominatim
    async geocodeNominatim(address) {
        try {
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
                        precision: 'high',
                        details: data[0]
                    };
                }
            }
        } catch (error) {
            console.warn('Nominatim error:', error);
        }
        
        return null;
    }

    // Геокодирование через Яндекс
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
                
                const pattern = /"geo":\s*\{[^}]*"latitude":\s*([\d.]+)[^}]*"longitude":\s*([\d.]+)/;
                const match = pattern.exec(html);
                
                if (match) {
                    const lat = parseFloat(match[1]);
                    const lng = parseFloat(match[2]);
                    
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

    // Основная функция геокодирования
    async geocode(address, region = '', city = '') {
        if (!address || address.trim().length < 3) {
            return null;
        }
        
        // Используем улучшенное геокодирование с регионом
        const result = await this.geocodeWithRegion(address, region, city);
        
        if (result) {
            return result;
        }
        
        // Запасной вариант
        const regionalCoords = this.getRegionCoordinates(region);
        if (regionalCoords) {
            const randomCoords = this.generateRandomInRegion(regionalCoords);
            return {
                lat: randomCoords.lat,
                lng: randomCoords.lng,
                address: address,
                source: `Regional Fallback: ${region}`,
                precision: 'very low',
                isApproximate: true,
                regionBased: true
            };
        }
        
        return null;
    }

    // Пакетное геокодирование
    async batchGeocode(addresses, progressCallback = null) {
        const results = [];
        const BATCH_SIZE = 3;
        
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
                    isApproximate: result ? result.isApproximate : false,
                    regionBased: result ? result.regionBased : false
                };
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                }
            });
            
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
    
    _cleanupCache() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('geocode_')) {
                keys.push(key);
            }
        }
        
        keys.sort((a, b) => {
            const dataA = JSON.parse(localStorage.getItem(a) || '{}');
            const dataB = JSON.parse(localStorage.getItem(b) || '{}');
            return (dataA.timestamp || 0) - (dataB.timestamp || 0);
        });
        
        const toDelete = keys.slice(0, Math.floor(keys.length / 2));
        toDelete.forEach(key => {
            localStorage.removeItem(key);
            this.quickCache.delete(key);
        });
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
        
        if (features.postalCode) score += this.weights.postalCode;
        if (features.region) score += this.weights.region;
        if (features.city) score += this.weights.city;
        if (features.street) score += this.weights.street;
        if (features.house) score += this.weights.house;
        
        score += Math.min(features.commaCount * this.weights.commaCount, 0.15);
        
        if (features.length > 20) {
            score += this.weights.minLength;
        }
        
        if (features.wordCount < 3) {
            score -= 0.2;
        }
        
        if (features.length < 10) {
            score -= 0.3;
        }
        
        return Math.max(0, Math.min(1, score));
    }
    
    predict(address) {
        const features = this.extractFeatures(address);
        const score = this.calculateScore(features);
        
        let quality, color;
        
        if (score > 0.75) {
            quality = "EXCELLENT";
            color = "#2ecc71";
        } else if (score > 0.55) {
            quality = "GOOD";
            color = "#f39c12";
        } else if (score > 0.35) {
            quality = "MEDIUM";
            color = "#3498db";
        } else {
            quality = "POOR";
            color = "#e74c3c";
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
