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

// ========== КЛАСС ГЕОКОДИРОВАНИЯ С ИДЕАЛЬНОЙ НОРМАЛИЗАЦИЕЙ ==========

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
        this._initNormalizationRules();
    }
    
    _initNormalizationRules() {
        // Полная база данных нормализации
        this.normalizationRules = {
            // Регионы России
            regions: {
                'московская': 'Московская область',
                'ленинградская': 'Ленинградская область',
                'свердловская': 'Свердловская область',
                'краснодарский': 'Краснодарский край',
                'алтайский': 'Алтайский край',
                'ставропольский': 'Ставропольский край',
                'приморский': 'Приморский край',
                'хабаровский': 'Хабаровский край',
                'ростовская': 'Ростовская область',
                'нижегородская': 'Нижегородская область',
                'челябинская': 'Челябинская область',
                'самарская': 'Самарская область',
                'новосибирская': 'Новосибирская область',
                'омская': 'Омская область',
                'томская': 'Томская область',
                'тюменская': 'Тюменская область',
                'иркутская': 'Иркутская область',
                'кемеровская': 'Кемеровская область',
                'воронежская': 'Воронежская область',
                'пензенская': 'Пензенская область',
                'ульяновская': 'Ульяновская область',
                'рязанская': 'Рязанская область',
                'астраханская': 'Астраханская область',
                'волгоградская': 'Волгоградская область',
                'калужская': 'Калужская область',
                'костромская': 'Костромская область',
                'курская': 'Курская область',
                'липецкая': 'Липецкая область',
                'орловская': 'Орловская область',
                'смоленская': 'Смоленская область',
                'тверская': 'Тверская область',
                'тульская': 'Тульская область',
                'ярославская': 'Ярославская область',
                'архангельская': 'Архангельская область',
                'вологодская': 'Вологодская область',
                'мурманская': 'Мурманская область',
                'новгородская': 'Новгородская область',
                'псковская': 'Псковская область',
                'белгородская': 'Белгородская область',
                'брянская': 'Брянская область',
                'владимирская': 'Владимирская область',
                'ивановская': 'Ивановская область',
                'калининградская': 'Калининградская область',
                'курганская': 'Курганская область',
                'кировская': 'Кировская область',
                'саратовская': 'Саратовская область',
                'тамбовская': 'Тамбовская область'
            },
            
            // Республики
            republics: {
                'татарстан': 'Республика Татарстан',
                'башкортостан': 'Республика Башкортостан',
                'дагестан': 'Республика Дагестан',
                'удмуртия': 'Удмуртская Республика',
                'чувашия': 'Чувашская Республика',
                'карелия': 'Республика Карелия',
                'мордовия': 'Республика Мордовия',
                'коми': 'Республика Коми',
                'марий эл': 'Республика Марий Эл',
                'северная осетия': 'Республика Северная Осетия - Алания',
                'кабардино-балкария': 'Кабардино-Балкарская Республика',
                'карачаево-черкесия': 'Карачаево-Черкесская Республика',
                'хакасия': 'Республика Хакасия',
                'алтай': 'Республика Алтай',
                'бурятия': 'Республика Бурятия',
                'тыва': 'Республика Тыва',
                'саха': 'Республика Саха (Якутия)',
                'адыгея': 'Республика Адыгея',
                'ингушетия': 'Республика Ингушетия',
                'калмыкия': 'Республика Калмыкия'
            },
            
            // Типы населенных пунктов (полные формы)
            settlementTypes: {
                'г': 'город',
                'гор': 'город',
                'город': 'город',
                'пгт': 'поселок городского типа',
                'рп': 'рабочий поселок',
                'пос': 'поселок',
                'поселок': 'поселок',
                'с': 'село',
                'село': 'село',
                'д': 'деревня',
                'деревня': 'деревня',
                'ст-ца': 'станица',
                'ст': 'станица',
                'станица': 'станица',
                'х': 'хутор',
                'хутор': 'хутор',
                'аул': 'аул',
                'киш': 'кишлак',
                'снт': 'садовое некоммерческое товарищество',
                'днт': 'дачное некоммерческое товарищество',
                'жк': 'жилой комплекс',
                'мкр': 'микрорайон',
                'кв-л': 'квартал'
            },
            
            // Типы улиц (полные формы)
            streetTypes: {
                'ул': 'улица',
                'улица': 'улица',
                'пр-кт': 'проспект',
                'пр': 'проспект',
                'проспект': 'проспект',
                'пер': 'переулок',
                'переулок': 'переулок',
                'ш': 'шоссе',
                'шоссе': 'шоссе',
                'б-р': 'бульвар',
                'бульвар': 'бульвар',
                'пр-д': 'проезд',
                'проезд': 'проезд',
                'аллея': 'аллея',
                'ал': 'аллея',
                'наб': 'набережная',
                'набережная': 'набережная',
                'пл': 'площадь',
                'площадь': 'площадь',
                'туп': 'тупик',
                'тупик': 'тупик',
                'линия': 'линия',
                'дор': 'дорога',
                'дорога': 'дорога',
                'мкр': 'микрорайон',
                'жилрайон': 'жилой район'
            },
            
            // Типы строений
            buildingTypes: {
                'д': 'дом',
                'дом': 'дом',
                'корп': 'корпус',
                'корпус': 'корпус',
                'стр': 'строение',
                'строение': 'строение',
                'влд': 'владение',
                'владение': 'владение',
                'лит': 'литера',
                'литера': 'литера',
                'зд': 'здание',
                'здание': 'здание',
                'пом': 'помещение',
                'помещение': 'помещение',
                'оф': 'офис',
                'офис': 'офис',
                'кв': 'квартира',
                'квартира': 'квартира',
                'под': 'подъезд',
                'подъезд': 'подъезд',
                'эт': 'этаж',
                'этаж': 'этаж',
                'секц': 'секция',
                'секция': 'секция'
            },
            
            // Слова-паразиты для удаления
            stopWords: [
                // Указания на торговые точки
                'торговая точка', 'торг\\.? точка', 'тт', 'магазин', 'торг центр',
                'торговый центр', 'торговый зал', 'павильон', 'киоск', 'ларек',
                'отдел', 'секция', 'витрина', 'прилавок', 'стойка',
                
                // Указания на здания
                'здание', 'строение', 'сооружение', 'постройка', 'объект',
                'помещение', 'пом\\.?', 'офисное помещение', 'торговое помещение',
                'производственное помещение', 'складское помещение',
                
                // Юридические термины
                'владение', 'влд\\.?', 'земельный участок', 'зем\\.? участок',
                'кадастровый номер', 'кадастр\\.? номер', 'кад\\.? номер',
                'нежилое помещение', 'жилое помещение', 'коммерческое помещение',
                
                // Географические указания
                'нас\\.? пункт', 'населенный пункт', 'насел\\.? пункт',
                'территория', 'тер\\.?', 'район', 'р-н', 'округ', 'окр',
                'микрорайон', 'мкр\\.?', 'жилой комплекс', 'жк', 'квартал', 'кв-л',
                'поселение', 'сельское поселение', 'городское поселение',
                
                // Разные
                'ориентир', 'рядом с', 'около', 'возле', 'напротив', 'через дорогу',
                'за углом', 'в районе', 'вблизи', 'недалеко от',
                'этаж', 'подъезд', 'вход', 'выход', 'фасад', 'тыльная сторона',
                'угол', 'перекресток', 'развязка', 'площадка', 'парковка'
            ],
            
            // Стандартные сокращения для восстановления
            standardAbbreviations: {
                'им': 'имени',
                'пр-т': 'проспект',
                'б-р': 'бульвар',
                'наб': 'набережная',
                'пл': 'площадь',
                'ш': 'шоссе',
                'пер': 'переулок',
                'туп': 'тупик',
                'ал': 'аллея',
                'пр-д': 'проезд',
                'ост': 'остров',
                'парк': 'парк',
                'сад': 'сад',
                'сквер': 'сквер',
                'бульв': 'бульвар',
                'просп': 'проспект',
                'ул\\.': 'улица',
                'пр\\.': 'проспект',
                'пер\\.': 'переулок',
                'ш\\.': 'шоссе',
                'б-р\\.': 'бульвар'
            }
        };
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
    
    // ИДЕАЛЬНАЯ НОРМАЛИЗАЦИЯ АДРЕСОВ ДЛЯ ЛЮБОГО СЛУЧАЯ
    normalizeRussianAddress(address, region = '') {
        if (!address) return '';
        
        let normalized = address.toString().trim();
        const original = normalized;
        
        // Шаг 1: Сохраняем исходный адрес для отладки
        console.log(`🔧 Начало нормализации: "${original}"`);
        
        // Шаг 2: Приводим к нижнему регистру для обработки
        let processing = normalized.toLowerCase();
        
        // Шаг 3: Удаляем почтовые индексы (6 цифр в начале или конце)
        processing = processing.replace(/^\d{6},?\s*/, '');
        processing = processing.replace(/,\s*\d{6}$/, '');
        
        // Шаг 4: Удаляем содержимое в скобках и сами скобки
        processing = processing.replace(/\([^)]*\)/g, ' ');
        processing = processing.replace(/\[[^\]]*\]/g, ' ');
        processing = processing.replace(/\{[^}]*\}/g, ' ');
        
        // Шаг 5: Удаляем кавычки и лишние символы
        processing = processing.replace(/["']/g, ' ');
        processing = processing.replace(/[#*]/g, ' ');
        
        // Шаг 6: Обрабатываем специальные форматы адресов
        
        // Формат: "Регион / Регион, Населенный пункт, Адрес"
        processing = processing.replace(/([а-яё\s]+)\s*\/\s*([а-яё\s]+),\s*/gi, '$2, ');
        
        // Формат: "Регионул. Город Улица" → "Регион, город, улица"
        processing = processing.replace(/([а-яё]+)ул\.?\s*([а-яё]+)\s+([а-яё]+)/gi, '$1, город $2, улица $3');
        
        // Формат: "Город (Нас.пункт)" → "Город"
        processing = processing.replace(/([а-яё]+)\s*\([^)]*нас[^)]*\)/gi, '$1');
        
        // Шаг 7: Нормализация регионов
        for (const [short, full] of Object.entries(this.normalizationRules.regions)) {
            const regex = new RegExp(`\\b${short}\\b`, 'gi');
            processing = processing.replace(regex, full);
        }
        
        // Нормализация республик
        for (const [short, full] of Object.entries(this.normalizationRules.republics)) {
            const regex = new RegExp(`\\b${short}\\b`, 'gi');
            processing = processing.replace(regex, full);
        }
        
        // Шаг 8: Добавляем "область", "край", "республика" если не указано
        if (!processing.includes('область') && !processing.includes('край') && !processing.includes('республика')) {
            // Проверяем, есть ли известный регион в адресе
            for (const regionName of Object.keys(this.normalizationRules.regions)) {
                if (processing.includes(regionName) && !processing.includes('область')) {
                    processing = processing.replace(new RegExp(`\\b${regionName}\\b`, 'gi'), this.normalizationRules.regions[regionName]);
                    break;
                }
            }
        }
        
        // Шаг 9: Нормализация населенных пунктов
        for (const [short, full] of Object.entries(this.normalizationRules.settlementTypes)) {
            // Обрабатываем с точкой и без
            const regex1 = new RegExp(`\\b${short}\\.?\\s+([а-яё-]+)`, 'gi');
            const regex2 = new RegExp(`\\b${short}\\.?$`, 'gi');
            
            processing = processing.replace(regex1, `${full} $1`);
            processing = processing.replace(regex2, full);
        }
        
        // Шаг 10: Нормализация улиц
        for (const [short, full] of Object.entries(this.normalizationRules.streetTypes)) {
            const regex1 = new RegExp(`\\b${short}\\.?\\s+([а-яё-]+)`, 'gi');
            const regex2 = new RegExp(`\\b${short}\\.?$`, 'gi');
            
            processing = processing.replace(regex1, `${full} $1`);
            processing = processing.replace(regex2, full);
        }
        
        // Шаг 11: Нормализация строений
        for (const [short, full] of Object.entries(this.normalizationRules.buildingTypes)) {
            const regex = new RegExp(`\\b${short}\\.?\\s*(\\d+[а-я]?)`, 'gi');
            processing = processing.replace(regex, `${full} $1`);
        }
        
        // Шаг 12: Обработка номеров домов
        
        // Формат: "дом № зд. 31Б" → "дом 31Б"
        processing = processing.replace(/дом\s*№?\s*зд\.?\s*(\d+[а-я]?)/gi, 'дом $1');
        
        // Формат: "дом № 71, пом. Н-2" → "дом 71, помещение Н-2"
        processing = processing.replace(/дом\s*№?\s*(\d+[а-я]?),\s*пом\.?\s*([а-я\d-]+)/gi, 'дом $1, помещение $2');
        
        // Формат: "корпус № 1" → "корпус 1"
        processing = processing.replace(/(корпус|строение|владение|литера)\s*№?\s*(\d+[а-я]?)/gi, '$1 $2');
        
        // Формат: "114/1" → "дом 114/1"
        processing = processing.replace(/(\d+\/\d+)(?!\d)/g, 'дом $1');
        
        // Формат: "25а" → "дом 25а"
        processing = processing.replace(/(^|,\s*|\s+)(\d+[а-я]?)(?=\s*$|,|\s)/g, '$1дом $2');
        
        // Шаг 13: Удаление стоп-слов
        for (const stopWord of this.normalizationRules.stopWords) {
            const regex = new RegExp(stopWord, 'gi');
            processing = processing.replace(regex, ' ');
        }
        
        // Шаг 14: Восстановление стандартных сокращений
        for (const [abbr, full] of Object.entries(this.normalizationRules.standardAbbreviations)) {
            const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
            processing = processing.replace(regex, full);
        }
        
        // Шаг 15: Очистка и форматирование
        
        // Удаляем двойные пробелы
        processing = processing.replace(/\s+/g, ' ');
        
        // Удаляем лишние запятые
        processing = processing.replace(/,+/g, ',');
        processing = processing.replace(/,\s*,/g, ',');
        
        // Удаляем запятые в начале/конце
        processing = processing.replace(/^,\s*/, '');
        processing = processing.replace(/,\s*$/, '');
        
        // Удаляем лишние пробелы вокруг запятых
        processing = processing.replace(/\s*,\s*/g, ', ');
        
        // Тримим
        processing = processing.trim();
        
        // Шаг 16: Разбиваем на части и упорядочиваем
        const parts = processing.split(',').map(p => p.trim()).filter(p => p.length > 0);
        
        if (parts.length > 0) {
            const orderedParts = [];
            const processedParts = new Set();
            
            // Правила приоритета для сортировки частей
            const priorityRules = [
                // 1. Регион/республика/край
                { test: (p) => p.includes('область') || p.includes('край') || p.includes('Республика'), priority: 1 },
                
                // 2. Город/поселок/село
                { test: (p) => p.includes('город') || p.includes('поселок') || p.includes('село') || 
                               p.includes('деревня') || p.includes('станица'), priority: 2 },
                
                // 3. Улица/проспект/бульвар
                { test: (p) => p.includes('улица') || p.includes('проспект') || p.includes('бульвар') || 
                               p.includes('шоссе') || p.includes('переулок'), priority: 3 },
                
                // 4. Дом/корпус/строение
                { test: (p) => p.startsWith('дом') || p.startsWith('корпус') || 
                               p.startsWith('строение') || p.startsWith('владение'), priority: 4 },
                
                // 5. Помещение/офис/квартира
                { test: (p) => p.includes('помещение') || p.includes('офис') || 
                               p.includes('квартира') || p.includes('литера'), priority: 5 }
            ];
            
            // Сначала добавляем части по приоритету
            for (let priority = 1; priority <= 5; priority++) {
                for (const part of parts) {
                    const rule = priorityRules.find(r => r.priority === priority);
                    if (rule && rule.test(part) && !processedParts.has(part)) {
                        orderedParts.push(part);
                        processedParts.add(part);
                    }
                }
            }
            
            // Затем добавляем оставшиеся части
            for (const part of parts) {
                if (!processedParts.has(part)) {
                    orderedParts.push(part);
                    processedParts.add(part);
                }
            }
            
            processing = orderedParts.join(', ');
        }
        
        // Шаг 17: Капитализация
        
        // Разбиваем на слова
        let words = processing.split(' ');
        
        // Правила капитализации
        words = words.map((word, index) => {
            // Сохраняем номера домов как есть
            if (word.match(/^\d+[а-я]?$/) || word.match(/^\d+\/\d+$/)) {
                return word;
            }
            
            // Сохраняем номера помещений как есть
            if (word.match(/^[нн]\s*[-–]\s*\d+$/i) || word.match(/^[а-я]\s*[-–]\s*\d+$/i)) {
                return word;
            }
            
            // Капитализируем первое слово в части
            if (index === 0 || words[index - 1] === ',') {
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }
            
            // Капитализируем названия улиц, городов и т.д.
            const lowerWord = word.toLowerCase();
            if (lowerWord === 'улица' || lowerWord === 'проспект' || lowerWord === 'бульвар' || 
                lowerWord === 'переулок' || lowerWord === 'шоссе' || lowerWord === 'аллея' ||
                lowerWord === 'город' || lowerWord === 'поселок' || lowerWord === 'село' ||
                lowerWord === 'деревня' || lowerWord === 'станица') {
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }
            
            // Для слов с дефисом (Санкт-Петербург, Ростов-на-Дону)
            if (word.includes('-')) {
                return word.split('-').map(part => 
                    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
                ).join('-');
            }
            
            return word.toLowerCase();
        });
        
        processing = words.join(' ');
        
        // Шаг 18: Добавляем "Россия" если не указано
        if (!processing.toLowerCase().includes('россия') && 
            !processing.toLowerCase().includes('russia')) {
            processing += ', Россия';
        }
        
        // Шаг 19: Если регион передан отдельно, добавляем его в начало
        if (region && !processing.toLowerCase().includes(region.toLowerCase())) {
            const normalizedRegion = this._normalizeRegionName(region);
            if (!processing.startsWith(normalizedRegion)) {
                processing = normalizedRegion + ', ' + processing;
            }
        }
        
        // Шаг 20: Финальная очистка
        processing = processing.replace(/\s+/g, ' ');
        processing = processing.replace(/,\s*,/g, ',');
        processing = processing.trim();
        
        console.log(`✅ Нормализация завершена: "${original}" → "${processing}"`);
        return processing;
    }
    
    // Вспомогательная функция для нормализации названий регионов
    _normalizeRegionName(region) {
        if (!region) return '';
        
        let normalized = region.trim();
        const lowerRegion = normalized.toLowerCase();
        
        // Проверяем, является ли регион известным
        for (const [short, full] of Object.entries(this.normalizationRules.regions)) {
            if (lowerRegion.includes(short)) {
                return full;
            }
        }
        
        for (const [short, full] of Object.entries(this.normalizationRules.republics)) {
            if (lowerRegion.includes(short)) {
                return full;
            }
        }
        
        // Если не нашли в базе, нормализуем вручную
        if (lowerRegion.includes('обл') && !lowerRegion.includes('область')) {
            normalized = normalized.replace(/обл\.?/i, 'область');
        }
        
        if (lowerRegion.includes('край') && !lowerRegion.includes(' край')) {
            normalized = normalized.replace(/край/i, 'край');
        }
        
        if (lowerRegion.includes('респ') && !lowerRegion.includes('республика')) {
            normalized = normalized.replace(/респ\.?/i, 'Республика');
        }
        
        // Капитализируем
        normalized = normalized.split(' ').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        
        return normalized;
    }
    
    // Генерация ключа для кэша
    getCacheKey(address, region = '') {
        const normalized = this.normalizeRussianAddress(address, region).toLowerCase();
        // Удаляем все не-буквенно-цифровые символы для стабильного ключа
        const key = normalized.replace(/[^а-яёa-z0-9]/g, '');
        return btoa(encodeURIComponent(key)).substring(0, 50);
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
        
        // Сохраняем кэш каждые 10 записей
        if (this.cache.size % 10 === 0) {
            this.saveCache();
        }
    }
    
    // Генерация вариантов запросов для OSM с учетом идеальной нормализации
    generateOSMQueries(address, region = '') {
        const normalized = this.normalizeRussianAddress(address, region);
        const parts = normalized.split(',').map(p => p.trim()).filter(p => p.length > 0);
        const queries = new Set();
        
        // 1. Полный нормализованный адрес
        queries.add(normalized);
        
        // 2. Без "Россия"
        if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'россия') {
            queries.add(parts.slice(0, -1).join(', '));
        }
        
        // 3. Разные комбинации частей адреса
        for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j <= Math.min(i + 3, parts.length); j++) {
                const combination = parts.slice(i, j).join(', ');
                if (combination.length >= 10) {
                    queries.add(combination);
                }
            }
        }
        
        // 4. Специальные варианты для домов
        const houseIndex = parts.findIndex(p => p.toLowerCase().startsWith('дом'));
        if (houseIndex !== -1 && houseIndex > 0) {
            // Адрес без номера дома
            queries.add(parts.slice(0, houseIndex).join(', '));
            
            // Только улица + дом
            if (houseIndex >= 2) {
                queries.add(parts.slice(houseIndex - 1).join(', '));
            }
        }
        
        // 5. Убираем дополнительные детали (помещения, литера и т.д.)
        const simpleParts = parts.filter(p => 
            !p.toLowerCase().includes('помещение') &&
            !p.toLowerCase().includes('офис') &&
            !p.toLowerCase().includes('литера') &&
            !p.toLowerCase().includes('строение') &&
            !p.toLowerCase().includes('корпус') &&
            !p.match(/^[нн]\s*[-–]\s*\d+$/i)
        );
        
        if (simpleParts.length > 0 && simpleParts.length < parts.length) {
            queries.add(simpleParts.join(', '));
        }
        
        // 6. Для адресов с дробными номерами домов
        const fractionalHouse = parts.find(p => p.includes('/'));
        if (fractionalHouse) {
            const withoutFraction = parts.map(p => 
                p.replace(/\d+\/\d+/, '').trim()
            ).filter(p => p.length > 0);
            
            if (withoutFraction.length > 0) {
                queries.add(withoutFraction.join(', '));
            }
        }
        
        // Фильтруем короткие и дубликаты
        const filteredQueries = Array.from(queries)
            .filter(q => q && q.length >= 10)
            .sort((a, b) => b.length - a.length); // Сначала более полные адреса
        
        console.log(`🔍 Сгенерировано вариантов для OSM:`, filteredQueries);
        return filteredQueries.slice(0, 5); // Ограничиваем 5 вариантами
    }
    
    // Улучшенный запрос к Nominatim
    async queryNominatimExact(query) {
        const encoded = encodeURIComponent(query);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=5&countrycodes=ru&accept-language=ru&addressdetails=1&namedetails=1&polygon=0`;
        
        console.log(`🌍 OSM запрос: "${query.substring(0, 100)}..."`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': CONFIG.GEOCODING.osmUserAgent,
                    'Accept': 'application/json',
                    'Accept-Language': 'ru-RU,ru;q=0.9'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.warn(`❌ OSM ошибка HTTP: ${response.status}`);
                return null;
            }
            
            const data = await response.json();
            
            if (!data || data.length === 0) {
                return null;
            }
            
            // Ищем самый точный результат
            let bestResult = null;
            let bestScore = -1;
            
            for (const result of data) {
                let score = 0;
                
                // Бонус за точное совпадение типа
                if (result.type === 'house' || result.class === 'building') {
                    score += 100;
                }
                
                // Бонус за наличие номера дома
                if (result.address && result.address.house_number) {
                    score += 50;
                }
                
                // Бонус за близость к запросу
                if (result.display_name && result.display_name.toLowerCase().includes(query.toLowerCase())) {
                    score += 20;
                }
                
                // Бонус за тип "street"
                if (result.type === 'street') {
                    score += 10;
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestResult = result;
                }
            }
            
            if (bestResult) {
                const lat = parseFloat(bestResult.lat);
                const lon = parseFloat(bestResult.lon);
                
                // Проверяем, что координаты в пределах России
                if (lon >= 19 && lon <= 180 && lat >= 41 && lat <= 82) {
                    return {
                        lat: lat,
                        lng: lon,
                        displayName: bestResult.display_name || '',
                        address: bestResult.address || {},
                        type: bestResult.type || bestResult.class,
                        importance: bestResult.importance || 0,
                        score: bestScore
                    };
                }
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('⏰ Таймаут OSM запроса');
            } else {
                console.warn('⚠️ Ошибка OSM:', error.message);
            }
        }
        
        return null;
    }
    
    // Основная функция геокодирования через OSM
    async geocodeNominatim(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            // Получаем идеально нормализованный адрес
            const normalized = this.normalizeRussianAddress(address, region);
            
            // Проверяем кэш
            const cached = this.getFromCache(address, region);
            if (cached) {
                return cached;
            }
            
            // Соблюдаем задержку для OSM
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.nominatim || 1000));
            
            // Генерируем варианты запросов
            const queries = this.generateOSMQueries(address, region);
            
            let bestResult = null;
            let bestQuery = '';
            
            // Пробуем все варианты запросов
            for (const query of queries) {
                try {
                    const result = await this.queryNominatimExact(query);
                    
                    if (result) {
                        // Оцениваем результат
                        const isExact = result.type === 'house' || 
                                       result.type === 'building' || 
                                       (result.address && result.address.house_number);
                        
                        if (isExact) {
                            console.log(`✅ OSM нашел ТОЧНЫЙ адрес: ${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`);
                            bestResult = result;
                            bestQuery = query;
                            break;
                        } else if (!bestResult || result.importance > bestResult.importance) {
                            bestResult = result;
                            bestQuery = query;
                        }
                    }
                    
                    // Задержка между попытками
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (e) {
                    console.warn(`⚠️ Ошибка запроса OSM:`, e.message);
                    continue;
                }
            }
            
            if (bestResult) {
                const isExact = bestResult.type === 'house' || 
                               bestResult.type === 'building' || 
                               (bestResult.address && bestResult.address.house_number);
                
                this.stats.nominatim++;
                
                const result = {
                    lat: bestResult.lat,
                    lng: bestResult.lng,
                    source: 'nominatim',
                    isExact: isExact,
                    normalized: normalized,
                    displayName: bestResult.displayName,
                    query: bestQuery
                };
                
                // Сохраняем в кэш
                this.saveToCache(address, region, bestResult.lat, bestResult.lng, 'nominatim', isExact);
                
                return result;
            }
            
            console.log(`❌ OSM не нашел адрес: ${normalized.substring(0, 80)}...`);
            return null;
            
        } catch (error) {
            console.warn('❌ Ошибка OSM геокодирования:', error.message);
            return null;
        }
    }
    
    // Функция геокодирования Яндекс (остается для сравнения)
    async geocodeYandex(address, region = '') {
        if (!CONFIG.GEOCODING?.enabled) return null;
        
        try {
            const normalized = this.normalizeRussianAddress(address, region);
            
            const cached = this.getFromCache(address, region);
            if (cached) {
                return cached;
            }
            
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.GEOCODING.delays?.yandex || 1500));
            
            // Убираем "Россия" для Яндекса
            const searchAddress = normalized.replace(/,\s*Россия$/i, '');
            const encoded = encodeURIComponent(searchAddress);
            const yandexUrl = `https://geocode-maps.yandex.ru/1.x/?format=json&geocode=${encoded}&results=1`;
            
            const proxyUrls = CONFIG.GEOCODING.proxy?.urls || [
                'https://corsproxy.io/?',
                'https://api.corsproxy.io/?'
            ];
            
            for (let i = 0; i < proxyUrls.length; i++) {
                const proxyUrl = proxyUrls[i];
                
                try {
                    const proxyFullUrl = `${proxyUrl}${encodeURIComponent(yandexUrl)}`;
                    console.log(`📍 Яндекс запрос: ${searchAddress.substring(0, 80)}...`);
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);
                    
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
                    const data = await response.json();
                    
                    // Обработка разных форматов прокси
                    if (proxyUrl.includes('corsproxy.io')) {
                        yandexData = data;
                    } else if (data.contents) {
                        yandexData = JSON.parse(data.contents);
                    } else {
                        yandexData = data;
                    }
                    
                    if (yandexData.response?.GeoObjectCollection?.featureMember?.length > 0) {
                        const pos = yandexData.response.GeoObjectCollection.featureMember[0]
                            .GeoObject.Point.pos.split(' ');
                        
                        const lon = parseFloat(pos[0]);
                        const lat = parseFloat(pos[1]);
                        
                        // Проверяем координаты в России
                        if (lon >= 19 && lon <= 180 && lat >= 41 && lat <= 82) {
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
                        }
                    }
                    
                } catch (proxyError) {
                    console.warn(`⚠️ Прокси ${i+1} не сработал:`, proxyError.message);
                    continue;
                }
            }
            
            console.log(`❌ Яндекс не нашел: ${searchAddress.substring(0, 80)}...`);
            return null;
            
        } catch (error) {
            console.warn('❌ Ошибка Яндекс:', error.message);
            return null;
        }
    }
    
    // Основная функция геокодирования
    async geocode(address, region = '', pointId = null) {
        if (!CONFIG.GEOCODING?.enabled || !address) {
            return this.getApproximateCoordinates(address, region);
        }
        
        this.stats.total++;
        console.log(`🔍 Геокодирование: "${address.substring(0, 100)}..."`);
        
        // Проверка кэша
        const cached = this.getFromCache(address, region);
        if (cached) {
            return cached;
        }
        
        const normalized = this.normalizeRussianAddress(address, region);
        
        // Порядок сервисов из конфига
        const serviceOrder = CONFIG.GEOCODING.serviceOrder || ['nominatim', 'yandex', 'overpass'];
        
        const serviceMap = {
            'nominatim': () => this.geocodeNominatim(address, region),
            'yandex': () => this.geocodeYandex(address, region),
            'overpass': () => this.geocodeOverpassAPI(address, region)
        };
        
        let result = null;
        let usedService = 'none';
        
        // Пробуем все сервисы по порядку
        for (const serviceName of serviceOrder) {
            if (!serviceMap[serviceName]) continue;
            
            try {
                console.log(`🔄 Пробуем ${serviceName}...`);
                result = await serviceMap[serviceName]();
                
                if (result) {
                    usedService = serviceName;
                    
                    // Если нашли точные координаты, останавливаемся
                    if (result.isExact) {
                        break;
                    }
                    
                    // Если нашли приблизительные, продолжаем поиск точных
                    console.log(`ℹ️ ${serviceName} нашел приблизительные координаты, продолжаем поиск...`);
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
            if (result.isExact) {
                // Обновляем точку на карте если нужно
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
    
    // Получение приблизительных координат по региону
    getApproximateCoordinates(address, region = '') {
        const regionCoords = {
            'Москва': { lat: 55.7558, lng: 37.6173, radius: 0.03 },
            'Московская область': { lat: 55.7558, lng: 37.6173, radius: 0.2 },
            'Санкт-Петербург': { lat: 59.9343, lng: 30.3351, radius: 0.03 },
            'Ленинградская область': { lat: 59.9343, lng: 30.3351, radius: 0.2 },
            'Алтайский край': { lat: 53.3481, lng: 83.7794, radius: 0.3 },
            'Краснодарский край': { lat: 45.0355, lng: 38.9753, radius: 0.2 },
            'Свердловская область': { lat: 56.8389, lng: 60.6057, radius: 0.2 },
            'Ростовская область': { lat: 47.2224, lng: 39.7189, radius: 0.2 },
            'Республика Татарстан': { lat: 55.7961, lng: 49.1064, radius: 0.2 },
            'Челябинская область': { lat: 55.1644, lng: 61.4368, radius: 0.2 },
            'Новосибирская область': { lat: 55.0084, lng: 82.9357, radius: 0.2 },
            'Самарская область': { lat: 53.1959, lng: 50.1002, radius: 0.2 },
            'Омская область': { lat: 54.9885, lng: 73.3686, radius: 0.2 },
            'Республика Башкортостан': { lat: 54.7351, lng: 55.9587, radius: 0.2 },
            'Пермский край': { lat: 58.0105, lng: 56.2502, radius: 0.2 },
            'Красноярский край': { lat: 56.0184, lng: 92.8672, radius: 0.3 },
            'Воронежская область': { lat: 51.6720, lng: 39.1843, radius: 0.2 },
            'Волгоградская область': { lat: 48.7071, lng: 44.5169, radius: 0.2 },
            'Саратовская область': { lat: 51.5336, lng: 46.0343, radius: 0.2 },
            'Тюменская область': { lat: 57.1530, lng: 65.5343, radius: 0.3 }
        };
        
        let baseLat = 55.7558;
        let baseLng = 37.6173;
        let radius = 2.0;
        
        const searchText = (region || address || '').toLowerCase();
        
        // Ищем точное совпадение региона
        for (const [key, coords] of Object.entries(regionCoords)) {
            if (searchText.includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                radius = coords.radius;
                break;
            }
        }
        
        // Генерируем случайные координаты в пределах региона
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
    
    // Обновление точки и маркера на карте
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
            
            // Анимация обновления маркера
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
        
        showNotification(`Координаты уточнены: ${point.name?.substring(0, 25)}...`, 'success', 3000);
    }
    
    // Добавление точки в очередь на геокодирование
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
        
        console.log(`📋 В очередь: ${point.address?.substring(0, 80)}...`);
    }
    
    // Обработка очереди
    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        
        try {
            // Сортируем по приоритету
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
                    
                    // Задержка между запросами
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
    
    // Фоновое геокодирование всех точек
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
    
    // Вывод статистики
    printStats() {
        console.log('📊 Статистика геокодирования:');
        console.log(`   Всего запросов: ${this.stats.total}`);
        console.log(`   Из кэша: ${this.stats.cached}`);
        console.log(`   OSM (точные): ${this.stats.nominatim}`);
        console.log(`   Яндекс: ${this.stats.yandex}`);
        console.log(`   Приблизительные: ${this.stats.approximate}`);
        console.log(`   Не найдено: ${this.stats.failed}`);
        console.log(`   Размер кэша: ${this.cache.size} записей`);
        console.log(`   В очереди: ${this.queue.length} задач`);
    }
    
    // Очистка кэша
    clearCache() {
        this.cache.clear();
        localStorage.removeItem('geocoding_cache');
        console.log('🧹 Кэш очищен');
        showNotification('Кэш геокодирования очищен', 'success');
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========

function initApp() {
    console.log('🚀 Инициализация приложения...');
    console.log('📋 Конфигурация геокодирования:', CONFIG.GEOCODING);
    
    try {
        initMap();
        
        if (CONFIG.GEOCODING?.enabled) {
            geocodingSystem = new GeocodingSystem();
            console.log('✅ Система геокодирования инициализирована');
        }
        
        // Загружаем данные
        loadData();
        
        // Настраиваем автообновление
        setupAutoUpdate();
        
        // Запускаем периодическую проверку очереди
        if (geocodingSystem) {
            setInterval(() => {
                if (geocodingSystem.queue.length > 0 && !geocodingSystem.processing) {
                    geocodingSystem.processQueue();
                }
            }, 30000);
        }
        
        updateStatus('Приложение готово');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        showNotification('Ошибка инициализации приложения', 'error');
        updateStatus('Ошибка инициализации');
    }
}

document.addEventListener('DOMContentLoaded', initApp);

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========

function initMap() {
    console.log('🗺️  Инициализация карты...');
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('❌ Элемент карты не найден!');
        showNotification('Ошибка: элемент карты не найден', 'error');
        return;
    }
    
    try {
        map = L.map('map').setView(CONFIG.MAP.center, CONFIG.MAP.zoom);
        
        L.tileLayer(CONFIG.MAP.tileLayer, {
            attribution: CONFIG.MAP.attribution,
            maxZoom: 18
        }).addTo(map);
        
        // Настраиваем кластеризацию маркеров
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 40,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
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
                    html: `<div style="background:${color}; color:white; width:42px; height:42px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 3px 6px rgba(0,0,0,0.3); font-size:14px;">${count}</div>`,
                    className: 'custom-cluster',
                    iconSize: [42, 42]
                });
            }
        }).addTo(map);
        
        console.log('✅ Карта успешно инициализирована');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации карты:', error);
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
    // Удаляем старые уведомления
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
    }
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 25px;
            right: 25px;
            padding: 18px 22px;
            background: white;
            color: #2c3e50;
            border-radius: 12px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.2);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 14px;
            animation: slideIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            max-width: 450px;
            min-width: 320px;
            border-left: 5px solid ${bgColor};
            font-family: 'Segoe UI', Tahoma, sans-serif;
        ">
            <div style="
                width: 40px;
                height: 40px;
                background: ${bgColor}15;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            ">
                <i class="fas fa-${icon}" style="color: ${iconColor}; font-size: 18px;"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 15px; margin-bottom: 5px;">
                    ${type === 'success' ? 'Успешно' : 
                      type === 'error' ? 'Ошибка' : 
                      type === 'warning' ? 'Внимание' : 'Информация'}
                </div>
                <div style="font-size: 14px; line-height: 1.5;">${message}</div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="
                background: none;
                border: none;
                color: #95a5a6;
                cursor: pointer;
                font-size: 16px;
                padding: 5px;
                border-radius: 5px;
                transition: all 0.2s;
                flex-shrink: 0;
            ">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Автоматическое закрытие
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
    if (isLoading) {
        showNotification('Данные уже загружаются', 'info');
        return;
    }
    
    isLoading = true;
    
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        console.log('📥 Начинаю загрузку данных...');
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`✅ Данные загружены: ${data.length} строк`);
        allPoints = processData(data);
        console.log(`✅ Обработано точек: ${allPoints.length}`);
        
        // Быстро добавляем координаты (из кэша или приблизительные)
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`✅ Координаты добавлены: ${allPoints.length}`);
        
        updateFilters();
        updateStatistics();
        updateGeocodingStats();
        showPointsOnMap();
        
        // Запускаем фоновое геокодирование
        if (CONFIG.GEOCODING?.enabled && CONFIG.GEOCODING.autoGeocode && geocodingSystem) {
            setTimeout(() => {
                geocodingSystem.startBackgroundGeocoding();
            }, 2000);
        }
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        showNotification(`Данные успешно загружены: ${allPoints.length} точек`, 'success');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Используются демо-данные.', 'error');
        
        // Показываем демо-данные
        if (allPoints.length === 0) {
            showDemoData();
        }
        
    } finally {
        isLoading = false;
    }
}

async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&id=${CONFIG.SPREADSHEET_ID}`;
    
    console.log(`📥 Загружаю CSV: ${url}`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        return parseCSV(csvText);
        
    } catch (error) {
        console.error('❌ Ошибка загрузки CSV:', error);
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
        console.error('❌ Ошибка парсинга CSV:', error);
        return [];
    }
}

// ========== ОБРАБОТКА ДАННЫХ ==========

function processData(rows) {
    console.log('🔄 Начинаю обработку данных...');
    
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
            id: `point_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sheetRow: i + 1,
            name: '',
            region: '',
            address: '',
            status: '',
            manager: '',
            contractor: '',
            originalAddress: '',
            originalStatus: '',
            createdAt: new Date().toISOString()
        };
        
        // Заполняем поля из строки
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length && row[index]) {
                const value = row[index].toString().trim();
                if (value) point[key] = value;
            }
        });
        
        // Сохраняем оригинальные значения
        point.originalAddress = point.address;
        point.originalStatus = point.status;
        
        // Нормализуем адрес
        if (point.address && geocodingSystem) {
            point.address = geocodingSystem.normalizeRussianAddress(point.address, point.region);
        }
        
        // Нормализуем статус
        if (point.status && CONFIG.STATUS_MAPPING) {
            point.status = CONFIG.STATUS_MAPPING[point.status] || point.status;
        }
        
        // Генерируем имя если его нет
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
        
        // Добавляем точку если есть хоть какая-то информация
        if (point.name || point.address || point.region) {
            points.push(point);
        }
    }
    
    console.log(`✅ Обработано точек: ${points.length}`);
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
        'название': 'name',
        'регион': 'region', 
        'адрес': 'address',
        'статус тт': 'status',
        'статус': 'status',
        'менеджер фио': 'manager',
        'менеджер': 'manager',
        'подрядчик фио': 'contractor',
        'подрядчик': 'contractor'
    };
    
    // Сначала ищем точные совпадения
    headersLower.forEach((header, index) => {
        if (exactMatches[header]) {
            const field = exactMatches[header];
            if (indices[field] === -1) {
                indices[field] = index;
            }
        }
    });
    
    // Затем ищем частичные совпадения
    headersLower.forEach((header, index) => {
        if (header.includes('назван') && indices.name === -1) indices.name = index;
        if (header.includes('регион') && indices.region === -1) indices.region = index;
        if (header.includes('адрес') && indices.address === -1) indices.address = index;
        if (header.includes('статус') && indices.status === -1) indices.status = index;
        if (header.includes('менеджер') && indices.manager === -1) indices.manager = index;
        if (header.includes('подрядчик') && indices.contractor === -1) indices.contractor = index;
    });
    
    // Если какие-то поля не найдены, используем первые доступные столбцы
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
    
    console.log('📋 Найдены индексы столбцов:', indices);
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
        
        // Если уже есть точные координаты, пропускаем
        if (point.lat && point.lng && !point.isMock) {
            updatedPoints.push(point);
            continue;
        }
        
        // Пробуем получить из кэша
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
        
        // Добавляем приблизительные координаты
        const approximate = geocodingSystem.getApproximateCoordinates(point.address, point.region);
        point.lat = approximate.lat;
        point.lng = approximate.lng;
        point.isMock = true;
        point.geocodingSource = 'approximate_initial';
        
        updatedPoints.push(point);
    }
    
    console.log(`✅ Быстрые координаты добавлены для ${updatedPoints.length} точек`);
    return updatedPoints;
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========

function showPointsOnMap() {
    console.log('📍 Показываю точки на карте...');
    
    // Очищаем старые маркеры
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`📍 Фильтровано точек: ${filteredPoints.length}`);
    
    // Сортируем точки: сначала точные, потом приблизительные
    const sortedPoints = [...filteredPoints].sort((a, b) => {
        if (a.isMock && !b.isMock) return 1;
        if (!a.isMock && b.isMock) return -1;
        return 0;
    });
    
    sortedPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        }
    });
    
    // Центрируем карту на отфильтрованных точках
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            filteredPoints
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { 
                padding: [60, 60], 
                maxZoom: 12,
                animate: true,
                duration: 1
            });
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
    
    // Индикатор точности координат
    let accuracyBadge = '';
    let badgeColor = '';
    
    if (point.isMock) {
        badgeColor = '#f39c12';
        accuracyBadge = `
            <div style="
                position: absolute;
                top: -6px;
                right: -6px;
                width: 14px;
                height: 14px;
                background: ${badgeColor};
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                z-index: 1000;
            " title="Приблизительные координаты"></div>
        `;
    } else if (point.geocodingSource === 'nominatim') {
        badgeColor = '#2ecc71';
        accuracyBadge = `
            <div style="
                position: absolute;
                top: -6px;
                right: -6px;
                width: 14px;
                height: 14px;
                background: ${badgeColor};
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                z-index: 1000;
            " title="Точные координаты (OSM)"></div>
        `;
    } else if (point.geocodingSource === 'yandex') {
        badgeColor = '#3498db';
        accuracyBadge = `
            <div style="
                position: absolute;
                top: -6px;
                right: -6px;
                width: 14px;
                height: 14px;
                background: ${badgeColor};
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                z-index: 1000;
            " title="Точные координаты (Яндекс)"></div>
        `;
    }
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
                <div style="
                    background: ${color};
                    width: 38px;
                    height: 38px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 15px;
                    transition: all 0.3s;
                    cursor: pointer;
                ">
                    ${point.name ? point.name.charAt(0).toUpperCase() : 'Т'}
                </div>
                ${accuracyBadge}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [38, 38],
        iconAnchor: [19, 38]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        pointId: point.id,
        isMock: point.isMock || false
    });
    
    marker.bindPopup(createPopupContent(point));
    
    // Обработчики событий
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
            markerElement.style.transform = 'scale(1.15)';
            markerElement.style.zIndex = '1000';
            markerElement.style.filter = 'brightness(1.1)';
        }
    });
    
    marker.on('mouseout', function() {
        const markerElement = marker.getElement();
        if (markerElement) {
            markerElement.style.transform = 'scale(1)';
            markerElement.style.zIndex = 'auto';
            markerElement.style.filter = 'brightness(1)';
        }
    });
    
    return marker;
}

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
        accuracyColor = '#3498db';
    } else if (point.geocodingSource === 'approximate') {
        accuracyInfo = 'Приблизительные координаты';
        accuracyIcon = 'fa-map-marker-alt';
        accuracyColor = '#f39c12';
    } else if (point.geocodingSource) {
        accuracyInfo = `Координаты (${point.geocodingSource})`;
        accuracyIcon = 'fa-map-marker-alt';
        accuracyColor = '#3498db';
    }
    
    return `
        <div style="min-width: 300px; max-width: 380px; font-family: 'Segoe UI', Tahoma, sans-serif;">
            <div style="
                background: ${color};
                color: white;
                padding: 14px 18px;
                border-radius: 10px 10px 0 0;
                margin: -12px -12px 12px -12px;
            ">
                <h4 style="margin: 0; font-size: 17px; display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-store"></i>
                    ${point.name || 'Без названия'}
                </h4>
            </div>
            
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 6px;">Статус</div>
                <div style="
                    display: inline-block;
                    background: ${color};
                    color: white;
                    padding: 5px 14px;
                    border-radius: 16px;
                    font-size: 14px;
                    font-weight: 500;
                ">
                    ${point.status || 'Не указан'}
                </div>
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес
                    </div>
                    <div style="font-size: 14px; line-height: 1.5; background: #f8f9fa; padding: 10px; border-radius: 6px; border: 1px solid #e9ecef;">
                        ${displayAddress}
                    </div>
                </div>
            ` : ''}
            
            <div style="
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 14px;
                margin-bottom: 18px;
                padding: 14px;
                background: #f8f9fa;
                border-radius: 8px;
            ">
                ${point.region ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 3px;">Регион</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.region}</div>
                    </div>
                ` : ''}
                
                ${point.manager ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 3px;">Менеджер</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.manager}</div>
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 3px;">Подрядчик</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.contractor}</div>
                    </div>
                ` : ''}
                
                ${point.geocodingSource ? `
                    <div>
                        <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 3px;">Источник</div>
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
                    margin-bottom: 12px;
                    padding: 10px 12px;
                    background: #e8f4fd;
                    border-radius: 6px;
                    font-size: 12px;
                    color: #2c3e50;
                ">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                        <i class="fas fa-crosshairs"></i>
                        <strong>Координаты:</strong>
                    </div>
                    <div>Широта: ${point.lat.toFixed(6)}</div>
                    <div>Долгота: ${point.lng.toFixed(6)}</div>
                </div>
            ` : ''}
            
            ${accuracyInfo ? `
                <div style="
                    padding: 10px 14px;
                    background: ${accuracyColor}15;
                    border: 1px solid ${accuracyColor}30;
                    border-radius: 8px;
                    font-size: 13px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                ">
                    <i class="fas ${accuracyIcon}" style="color: ${accuracyColor}; font-size: 14px;"></i>
                    <span style="color: #2c3e50; font-weight: 500;">${accuracyInfo}</span>
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========

function updateFilters() {
    console.log('🔧 Обновляю фильтры...');
    
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
    
    console.log(`✅ Фильтры обновлены: ${filters.regions.size} регионов, ${filters.statuses.size} статусов`);
}

function fillFilter(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Сохраняем выбранные значения
    const selected = Array.from(select.selectedOptions).map(opt => opt.value);
    select.innerHTML = '<option value="">Все</option>';
    
    // Добавляем опции
    options.forEach(option => {
        if (option && option.trim() !== '') {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            
            // Восстанавливаем выбранные значения
            if (selected.includes(option)) {
                opt.selected = true;
            }
            
            select.appendChild(opt);
        }
    });
}

function applyFilters() {
    console.log('🔍 Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('🧹 Сбрасываю фильтры...');
    
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.selectedIndex = 0;
            // Для множественного выбора сбрасываем все выбранные опции
            Array.from(select.options).forEach(option => {
                option.selected = option.value === "";
            });
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
        // Проверяем каждый фильтр
        if (activeFilters.projects.length > 0) {
            if (!point.project || !activeFilters.projects.includes(point.project)) {
                return false;
            }
        }
        
        if (activeFilters.regions.length > 0) {
            if (!point.region || !activeFilters.regions.includes(point.region)) {
                return false;
            }
        }
        
        if (activeFilters.statuses.length > 0) {
            if (!point.status || !activeFilters.statuses.includes(point.status)) {
                return false;
            }
        }
        
        if (activeFilters.managers.length > 0) {
            if (!point.manager || !activeFilters.managers.includes(point.manager)) {
                return false;
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
    
    console.log(`🔍 Поиск: "${query}"`);
    
    const results = allPoints.filter(point => {
        const searchFields = [
            point.name,
            point.address,
            point.region,
            point.manager,
            point.contractor,
            point.status
        ];
        
        return searchFields.some(field => 
            field && field.toLowerCase().includes(query)
        );
    });
    
    console.log(`🔍 Найдено результатов: ${results.length}`);
    
    if (results.length === 0) {
        showNotification('Ничего не найдено', 'info');
        return;
    }
    
    // Показываем только найденные точки
    markerCluster.clearLayers();
    
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    // Центрируем карту на результатах
    if (results.length > 0 && results.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            results
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [60, 60] });
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
    
    // Форматируем адрес для отображения
    let displayAddress = point.address || '';
    if (displayAddress.length > 100) {
        displayAddress = displayAddress.substring(0, 100) + '...';
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 18px;">
            <h5 style="color: white; margin-bottom: 8px; font-size: 17px; font-weight: 600;">${point.name || 'Без названия'}</h5>
            ${point.status ? `
                <span style="background: ${color}; color: white; padding: 4px 12px; border-radius: 15px; font-size: 13px; font-weight: 500;">
                    ${point.status}
                </span>
            ` : ''}
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 14px; border-radius: 8px; margin-bottom: 18px;">
            ${displayAddress ? `
                <p style="margin-bottom: 10px; line-height: 1.5;">
                    <strong style="color: #95a5a6; font-size: 12px;">📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${displayAddress}</span>
                </p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p style="margin: 0; font-size: 12px; color: #95a5a6;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
            ${point.region ? `
                <div>
                    <strong style="color: #95a5a6; font-size: 11px;">Регион:</strong><br>
                    <span style="font-weight: 500;">${point.region}</span>
                </div>
            ` : ''}
            
            ${point.manager ? `
                <div>
                    <strong style="color: #95a5a6; font-size: 11px;">Менеджер:</strong><br>
                    <span style="font-weight: 500;">${point.manager}</span>
                </div>
            ` : ''}
            
            ${point.contractor ? `
                <div>
                    <strong style="color: #95a5a6; font-size: 11px;">Подрядчик:</strong><br>
                    <span style="font-weight: 500;">${point.contractor}</span>
                </div>
            ` : ''}
            
            ${point.geocodingSource ? `
                <div>
                    <strong style="color: #95a5a6; font-size: 11px;">Источник:</strong><br>
                    <span style="font-weight: 500;">${point.geocodingSource}</span>
                </div>
            ` : ''}
        </div>
        
        ${point.isMock ? `
            <div style="margin-top: 18px; padding: 10px; background: #f39c12; color: white; border-radius: 8px; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
}

// ========== СТАТИСТИКА ==========

function updateStatistics() {
    const filteredPoints = filterPoints();
    const totalPoints = allPoints.length;
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const approximatePoints = filteredPoints.filter(p => p.isMock).length;
    
    const totalPointsElement = document.getElementById('total-points');
    const shownPointsElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    
    if (totalPointsElement) totalPointsElement.textContent = totalPoints;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) {
        const exactPercentage = totalPoints > 0 ? Math.round((exactPoints / totalPoints) * 100) : 0;
        accuracyElement.textContent = `${exactPoints}/${approximatePoints} (${exactPercentage}%)`;
    }
}

function updateGeocodingStats() {
    if (!geocodingSystem) return;
    
    const totalPoints = allPoints.length;
    const exactCoords = allPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const mockCoords = allPoints.filter(p => p.isMock).length;
    const noCoords = totalPoints - exactCoords - mockCoords;
    
    const statsElement = document.getElementById('geocoding-stats');
    if (!statsElement) return;
    
    const stats = geocodingSystem.stats;
    const exactPercentage = totalPoints > 0 ? Math.round((exactCoords / totalPoints) * 100) : 0;
    
    statsElement.innerHTML = `
        <div style="margin-top: 15px; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 10px; border-left: 4px solid #3498db;">
            <div style="font-size: 13px; color: #ecf0f1; margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-map-marker-alt"></i> 
                <span>Точность координат</span>
                <div style="margin-left: auto; font-size: 12px; color: #95a5a6; font-weight: 500;">${exactPercentage}%</div>
            </div>
            
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 12px; color: #ecf0f1;">Точные координаты</span>
                    <span style="font-size: 12px; font-weight: bold; color: #2ecc71;">${exactCoords}</span>
                </div>
                <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${exactPercentage}%; height: 100%; background: #2ecc71; border-radius: 3px;"></div>
                </div>
            </div>
            
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 12px; color: #ecf0f1;">Приблизительные</span>
                    <span style="font-size: 12px; font-weight: bold; color: #f39c12;">${mockCoords}</span>
                </div>
                <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${Math.round((mockCoords / totalPoints) * 100)}%; height: 100%; background: #f39c12; border-radius: 3px;"></div>
                </div>
            </div>
            
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 11px; color: #95a5a6;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-database"></i>
                        <span>Кэш: ${stats.cached}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-globe-europe"></i>
                        <span>OSM: ${stats.nominatim}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <i class="fab fa-yandex"></i>
                        <span>Яндекс: ${stats.yandex}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-sync-alt"></i>
                        <span>Очередь: ${geocodingSystem.queue.length}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ========== АВТООБНОВЛЕНИЕ ==========

function setupAutoUpdate() {
    if (CONFIG.UPDATE?.auto) {
        updateInterval = setInterval(loadData, CONFIG.UPDATE.interval);
        console.log(`⏰ Автообновление настроено: ${CONFIG.UPDATE.interval}мс`);
    }
}

// ========== ДЕМО-ДАННЫЕ ==========

function showDemoData() {
    console.log('🎮 Показываем демо-данные...');
    
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
            region: 'Московская область',
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



