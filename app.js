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
let regionStats = {};
let geocodingQueue = [];
let isGeocoding = false;

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    loadData();
    setupAutoUpdate();
});

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
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
            
            // Определяем цвет кластера
            let color = CONFIG.STATUS_COLORS.default;
            const statuses = markers.map(m => m.options.status);
            
            if (statuses.includes('Закрыта') || statuses.includes('Отправлен ФО, не принят')) {
                color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
            } else if (statuses.includes('На паузе')) {
                color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
            } else if (statuses.includes('сдан') || statuses.includes('Сдан') || statuses.includes('Активная')) {
                color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
            }
            
            return L.divIcon({
                html: `<div style="background:${color}; color:white; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);">${count}</div>`,
                className: 'custom-cluster',
                iconSize: [40, 40]
            });
        }
    }).addTo(map);
}

// ========== ЗАГРУЗКА ДАННЫХ ИЗ GOOGLE SHEETS ==========
async function loadData() {
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        // 1. Загружаем данные как CSV
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        // 2. Обрабатываем данные
        allPoints = processData(data);
        
        // 3. Инициализируем статистику по регионам
        initRegionStats();
        
        // 4. Интеллектуальное геокодирование с использованием регионов
        allPoints = await smartGeocodeWithRegions(allPoints);
        
        // 5. Сразу показываем точки на карте
        updateFilters();
        updateStatistics();
        updateLegend();
        updateRegionStats();
        showPointsOnMap();
        
        // 6. Скрываем модальное окно
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        
        showNotification('Данные успешно загружены', 'success');
        
        // 7. Запускаем фоновое улучшение геокодирования
        setTimeout(backgroundSmartGeocoding, 5000);
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        // Пробуем альтернативный метод
        setTimeout(tryAlternativeLoad, 5000);
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ СТАТИСТИКИ РЕГИОНОВ ==========
function initRegionStats() {
    regionStats = {};
    
    // Инициализируем для каждого региона
    Object.keys(CONFIG.GEOCODING.REGION_CENTERS).forEach(region => {
        regionStats[region] = {
            total: 0,
            geocoded: 0,
            approximate: 0,
            failed: 0,
            cities: new Set()
        };
    });
    
    regionStats['Другие'] = {
        total: 0,
        geocoded: 0,
        approximate: 0,
        failed: 0,
        cities: new Set()
    };
}

// ========== ОБНОВЛЕНИЕ СТАТИСТИКИ РЕГИОНОВ ==========
function updateRegionStats() {
    // Сбрасываем статистику
    Object.keys(regionStats).forEach(region => {
        regionStats[region].total = 0;
        regionStats[region].geocoded = 0;
        regionStats[region].approximate = 0;
        regionStats[region].failed = 0;
        regionStats[region].cities.clear();
    });
    
    // Собираем статистику
    allPoints.forEach(point => {
        const region = normalizeRegion(point.region) || 'Другие';
        const regionKey = Object.keys(CONFIG.GEOCODING.REGION_CENTERS).find(r => 
            normalizeRegion(r) === region
        ) || 'Другие';
        
        const stats = regionStats[regionKey] || regionStats['Другие'];
        
        stats.total++;
        
        if (point.lat && point.lng) {
            if (point.isMock) {
                stats.approximate++;
            } else {
                stats.geocoded++;
            }
        } else {
            stats.failed++;
        }
        
        // Добавляем город если есть
        if (point.city) {
            stats.cities.add(point.city);
        }
    });
    
    // Обновляем отображение статистики если есть элемент
    updateRegionStatsDisplay();
}

function updateRegionStatsDisplay() {
    const container = document.getElementById('region-stats');
    if (!container) return;
    
    let html = '<h5><i class="fas fa-map-marked-alt"></i> Статистика по регионам</h5>';
    
    // Сортируем регионы по количеству точек
    const sortedRegions = Object.entries(regionStats)
        .filter(([region, stats]) => stats.total > 0)
        .sort((a, b) => b[1].total - a[1].total);
    
    if (sortedRegions.length === 0) {
        html += '<p style="color: #95a5a6; font-size: 12px;">Нет данных по регионам</p>';
        container.innerHTML = html;
        return;
    }
    
    sortedRegions.forEach(([region, stats]) => {
        const successRate = stats.total > 0 ? Math.round((stats.geocoded / stats.total) * 100) : 0;
        const color = successRate > 80 ? '#2ecc71' : successRate > 50 ? '#f39c12' : '#e74c3c';
        
        html += `
            <div style="margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #34495e;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-weight: bold; font-size: 13px;">${region}</span>
                    <span style="font-size: 12px;">${stats.total} точек</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="flex-grow: 1; height: 6px; background: #2c3e50; border-radius: 3px; overflow: hidden;">
                        <div style="width: ${successRate}%; height: 100%; background: ${color}; border-radius: 3px;"></div>
                    </div>
                    <span style="font-size: 11px; color: ${color};">${successRate}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 10px; color: #95a5a6;">
                    <span>✅ ${stats.geocoded} точных</span>
                    <span>📍 ${stats.approximate} приблизительных</span>
                    <span>❌ ${stats.failed} не найдено</span>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ========== НОРМАЛИЗАЦИЯ РЕГИОНОВ ==========
function normalizeRegion(region) {
    if (!region) return null;
    
    const regionStr = region.toString().trim();
    
    // Проверяем синонимы
    for (const [synonym, normalized] of Object.entries(CONFIG.GEOCODING.REGION_SYNONYMS)) {
        if (regionStr.toLowerCase().includes(synonym.toLowerCase())) {
            return normalized;
        }
    }
    
    // Ищем точное совпадение
    for (const knownRegion of Object.keys(CONFIG.GEOCODING.REGION_CENTERS)) {
        if (regionStr.toLowerCase() === knownRegion.toLowerCase() || 
            knownRegion.toLowerCase().includes(regionStr.toLowerCase())) {
            return knownRegion;
        }
    }
    
    // Ищем частичное совпадение
    for (const knownRegion of Object.keys(CONFIG.GEOCODING.REGION_CENTERS)) {
        const words = regionStr.toLowerCase().split(/\s+/);
        const regionWords = knownRegion.toLowerCase().split(/\s+/);
        
        // Проверяем совпадение хотя бы одного слова
        if (words.some(word => regionWords.includes(word) && word.length > 3)) {
            return knownRegion;
        }
    }
    
    return regionStr;
}

// ========== УМНОЕ ГЕОКОДИРОВАНИЕ С РЕГИОНАМИ ==========
async function smartGeocodeWithRegions(points) {
    console.log('Запускаем умное геокодирование с региональной привязкой...');
    
    const BATCH_SIZE = 10;
    const updatedPoints = [];
    
    // Проходимся по точкам пакетами
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
        const batch = points.slice(i, i + BATCH_SIZE);
        
        // Обновляем прогресс
        if (i % 50 === 0) {
            const progress = Math.round((i / points.length) * 100);
            updateModal('Геокодирование', 
                `Обработка точек: ${i} из ${points.length} (${progress}%)...`);
        }
        
        // Обрабатываем пакет параллельно
        const promises = batch.map(async (point) => {
            return await smartGeocodePoint(point);
        });
        
        const results = await Promise.allSettled(promises);
        
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                updatedPoints.push(result.value);
            }
        });
        
        // Задержка для соблюдения лимитов
        if (i + BATCH_SIZE < points.length && points.length > 50) {
            await sleep(200);
        }
    }
    
    console.log('Умное геокодирование завершено:', updatedPoints.length, 'точек');
    return updatedPoints;
}

async function smartGeocodePoint(point) {
    // Если уже есть точные координаты - возвращаем как есть
    if (point.lat && point.lng && !point.isMock) {
        return point;
    }
    
    const region = normalizeRegion(point.region);
    
    // 1. Проверяем кэш с учетом региона
    const cacheKey = `geocode_${point.address}_${region}`.replace(/[^a-z0-9]/gi, '_');
    const cached = getFromCache(cacheKey);
    
    if (cached) {
        point.lat = cached.lat;
        point.lng = cached.lng;
        point.coordinates = `${cached.lat},${cached.lng}`;
        point.isMock = cached.isMock || false;
        point.geocodingSource = 'cache';
        return point;
    }
    
    // 2. Полный адрес с регионом для поиска
    let searchQuery = point.address || '';
    if (region && !searchQuery.toLowerCase().includes(region.toLowerCase())) {
        searchQuery = `${searchQuery}, ${region}`;
    }
    
    // 3. Пробуем разные алгоритмы геокодирования
    let geocodedResult = null;
    
    for (const algorithm of CONFIG.GEOCODING.ALGORITHMS) {
        try {
            switch (algorithm) {
                case 'smart':
                    geocodedResult = await smartGeocode(searchQuery, region, point);
                    break;
                case 'nominatim':
                    geocodedResult = await geocodeWithNominatim(searchQuery);
                    break;
                case 'region_based':
                    geocodedResult = await geocodeRegionBased(point, region);
                    break;
                case 'approximate':
                    geocodedResult = await approximateGeocode(point, region);
                    break;
            }
            
            if (geocodedResult) {
                break;
            }
        } catch (error) {
            console.warn(`Алгоритм ${algorithm} не сработал:`, error.message);
        }
    }
    
    // 4. Сохраняем результат
    if (geocodedResult) {
        point.lat = geocodedResult.lat;
        point.lng = geocodedResult.lng;
        point.coordinates = `${geocodedResult.lat},${geocodedResult.lng}`;
        point.isMock = geocodedResult.isMock || false;
        point.geocodingSource = geocodedResult.source || 'unknown';
        
        // Сохраняем в кэш
        saveToCache(cacheKey, {
            lat: geocodedResult.lat,
            lng: geocodedResult.lng,
            isMock: geocodedResult.isMock || false,
            source: geocodedResult.source || 'unknown',
            timestamp: Date.now()
        });
    } else {
        // Крайний случай - случайные координаты по региону
        point.lat = getRegionBasedCoordinate('lat', region);
        point.lng = getRegionBasedCoordinate('lng', region);
        point.coordinates = `${point.lat},${point.lng}`;
        point.isMock = true;
        point.geocodingSource = 'fallback';
    }
    
    return point;
}

async function smartGeocode(query, region, point) {
    // 1. Проверяем локальную базу с улучшенным поиском
    const localResult = searchInLocalDatabase(query, region, point);
    if (localResult) {
        return { ...localResult, source: 'local_db' };
    }
    
    // 2. Используем комбинированный подход Nominatim + регион
    if (region && CONFIG.GEOCODING.REGION_CENTERS[region]) {
        const regionCenter = CONFIG.GEOCODING.REGION_CENTERS[region];
        
        try {
            // Добавляем ограничение по региону для Nominatim
            const nominatimQuery = `${query}, Россия`;
            const encodedQuery = encodeURIComponent(nominatimQuery);
            
            const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&addressdetails=1&limit=1&viewbox=${regionCenter.lng-5},${regionCenter.lat+5},${regionCenter.lng+5},${regionCenter.lat-5}&bounded=1`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'TTMapApp/1.0',
                    'Accept': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.length > 0) {
                    const result = data[0];
                    return {
                        lat: parseFloat(result.lat),
                        lng: parseFloat(result.lon),
                        isMock: false,
                        source: 'nominatim_region'
                    };
                }
            }
        } catch (error) {
            // Игнорируем ошибку и пробуем дальше
        }
    }
    
    // 3. Пробуем стандартный Nominatim
    try {
        const nominatimResult = await geocodeWithNominatim(query);
        if (nominatimResult) {
            return { ...nominatimResult, source: 'nominatim' };
        }
    } catch (error) {
        // Игнорируем ошибку
    }
    
    return null;
}

function searchInLocalDatabase(query, region, point) {
    // Расширенная локальная база с ключами разного формата
    const searchKeys = [];
    
    // 1. Полный запрос
    searchKeys.push(query.toLowerCase().trim());
    
    // 2. Без лишних слов
    const cleanQuery = query.replace(/ул\.|улица|д\.|дом|корп\.|корпус|стр\.|строение/g, '').trim();
    searchKeys.push(cleanQuery.toLowerCase());
    
    // 3. Только основные слова (длиннее 3 символов)
    const mainWords = query.split(/\s+/).filter(word => word.length > 3).join(' ');
    searchKeys.push(mainWords.toLowerCase());
    
    // 4. Город + улица
    if (point.city) {
        searchKeys.push(`${point.city} ${point.street}`.toLowerCase());
    }
    
    // 5. Регион + город
    if (region && point.city) {
        searchKeys.push(`${region} ${point.city}`.toLowerCase());
    }
    
    // Проверяем каждый ключ в кэше
    for (const key of searchKeys) {
        const cacheKey = `local_${key}`.replace(/[^a-z0-9]/gi, '_');
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            try {
                const data = JSON.parse(cached);
                // Кэш на 60 дней для локальных данных
                if (Date.now() - data.timestamp < 60 * 24 * 60 * 60 * 1000) {
                    return {
                        lat: data.lat,
                        lng: data.lng,
                        isMock: data.isMock || false
                    };
                }
            } catch (e) {
                // Ошибка парсинга - удаляем невалидный кэш
                localStorage.removeItem(cacheKey);
            }
        }
    }
    
    return null;
}

async function geocodeWithNominatim(query) {
    try {
        const encodedQuery = encodeURIComponent(query + ', Россия');
        const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TTMapApp/1.0',
                'Accept': 'application/json',
                'Accept-Language': 'ru'
            },
            signal: AbortSignal.timeout(10000)
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                isMock: false
            };
        }
    } catch (error) {
        console.warn('Nominatim error:', error.message);
    }
    
    return null;
}

function geocodeRegionBased(point, region) {
    if (!region || !CONFIG.GEOCODING.REGION_CENTERS[region]) {
        return null;
    }
    
    const regionCenter = CONFIG.GEOCODING.REGION_CENTERS[region];
    
    // База городов в регионе (можно расширять)
    const regionCities = {
        'Московская область': {
            'Химки': { lat: 55.8890, lng: 37.4450 },
            'Королев': { lat: 55.9162, lng: 37.8545 },
            'Балашиха': { lat: 55.7963, lng: 37.9382 },
            'Мытищи': { lat: 55.9105, lng: 37.7364 },
            'Люберцы': { lat: 55.6720, lng: 37.8932 }
        },
        'Ленинградская область': {
            'Выборг': { lat: 60.7136, lng: 28.7388 },
            'Гатчина': { lat: 59.5687, lng: 30.1279 },
            'Тосно': { lat: 59.5409, lng: 30.8775 }
        },
        'Алтайский край': {
            'Бийск': { lat: 52.5410, lng: 85.2190 },
            'Рубцовск': { lat: 51.5270, lng: 81.2180 },
            'Новоалтайск': { lat: 53.4125, lng: 83.9315 },
            'Заринск': { lat: 53.7066, lng: 84.9314 }
        }
    };
    
    // Ищем город в регионе
    if (regionCities[region] && point.city) {
        for (const [city, coords] of Object.entries(regionCities[region])) {
            if (point.city.toLowerCase().includes(city.toLowerCase()) || 
                city.toLowerCase().includes(point.city.toLowerCase())) {
                
                // Добавляем случайное смещение для уникальности
                return {
                    lat: coords.lat + (Math.random() - 0.5) * 0.02,
                    lng: coords.lng + (Math.random() - 0.5) * 0.04,
                    isMock: true,
                    source: 'region_city'
                };
            }
        }
    }
    
    // Если город не найден, используем региональный центр с небольшим смещением
    return {
        lat: regionCenter.lat + (Math.random() - 0.5) * 0.5,
        lng: regionCenter.lng + (Math.random() - 0.5) * 1.0,
        isMock: true,
        source: 'region_center'
    };
}

function approximateGeocode(point, region) {
    // Приблизительное геокодирование на основе региона
    
    // Пробуем извлечь улицу и номер дома
    let street = '';
    let house = '';
    
    if (point.address) {
        // Простая логика для улицы
        const streetMatch = point.address.match(/(?:ул\.?|улица)\s+([^,]+)/i);
        if (streetMatch) street = streetMatch[1].trim();
        
        // Простая логика для дома
        const houseMatch = point.address.match(/(?:д\.?|дом|№)\s*(\d+[а-я]?)/i);
        if (houseMatch) house = houseMatch[1].trim();
    }
    
    // Генерируем координаты на основе региона
    const lat = getRegionBasedCoordinate('lat', region);
    const lng = getRegionBasedCoordinate('lng', region);
    
    // Добавляем небольшое смещение на основе улицы и дома
    let streetOffset = 0;
    let houseOffset = 0;
    
    if (street) {
        // Хеш улицы для псевдослучайного смещения
        const streetHash = stringHash(street);
        streetOffset = (streetHash % 1000) / 10000; // до 0.1 градуса
    }
    
    if (house) {
        const houseNum = parseInt(house) || 0;
        houseOffset = (houseNum % 100) / 10000; // до 0.01 градуса
    }
    
    return {
        lat: lat + streetOffset + houseOffset,
        lng: lng + streetOffset * 2 + houseOffset * 2,
        isMock: true,
        source: 'approximate'
    };
}

function getRegionBasedCoordinate(type, region) {
    // Возвращает координаты на основе региона
    
    if (region && CONFIG.GEOCODING.REGION_CENTERS[region]) {
        const center = CONFIG.GEOCODING.REGION_CENTERS[region];
        const offset = type === 'lat' ? 0.5 : 1.0; // Большее смещение по долготе
        
        return center[type === 'lat' ? 'lat' : 'lng'] + (Math.random() - 0.5) * offset;
    }
    
    // Дефолтные координаты России
    return type === 'lat' ? 
        55.7558 + (Math.random() - 0.5) * 10 : 
        37.6173 + (Math.random() - 0.5) * 20;
}

function stringHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Преобразуем в 32-битное целое
    }
    return Math.abs(hash);
}

// ========== КЭШИРОВАНИЕ ==========
function getFromCache(key) {
    try {
        const item = localStorage.getItem(`geocache_${key}`);
        if (!item) return null;
        
        const data = JSON.parse(item);
        
        // Проверяем срок годности (30 дней)
        if (Date.now() - data.timestamp > 30 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem(`geocache_${key}`);
            return null;
        }
        
        return data;
    } catch (e) {
        console.warn('Ошибка чтения кэша:', e);
        return null;
    }
}

function saveToCache(key, data) {
    try {
        localStorage.setItem(`geocache_${key}`, JSON.stringify(data));
    } catch (e) {
        console.warn('Ошибка записи в кэш:', e);
        // Очищаем старый кэш если закончилось место
        if (e.name === 'QuotaExceededError') {
            clearOldCache();
        }
    }
}

function clearOldCache() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('geocache_')) {
                keys.push(key);
            }
        }
        
        // Сортируем по времени (старые сначала)
        keys.sort((a, b) => {
            try {
                const dataA = JSON.parse(localStorage.getItem(a));
                const dataB = JSON.parse(localStorage.getItem(b));
                return (dataA.timestamp || 0) - (dataB.timestamp || 0);
            } catch {
                return 0;
            }
        });
        
        // Удаляем 20% самых старых записей
        const toRemove = Math.ceil(keys.length * 0.2);
        for (let i = 0; i < toRemove; i++) {
            localStorage.removeItem(keys[i]);
        }
        
        console.log('Очищен кэш:', toRemove, 'записей');
    } catch (e) {
        console.warn('Ошибка очистки кэша:', e);
    }
}

// ========== ФОНОВОЕ ГЕОКОДИРОВАНИЕ ==========
async function backgroundSmartGeocoding() {
    const pointsToImprove = allPoints.filter(p => 
        p.isMock && 
        p.address && 
        (!p.geocodingSource || p.geocodingSource === 'fallback' || p.geocodingSource === 'approximate')
    );
    
    if (pointsToImprove.length === 0) {
        console.log('Нет точек для улучшения геокодирования');
        return;
    }
    
    console.log('Фоновое улучшение геокодирования для', pointsToImprove.length, 'точек...');
    
    // Ограничиваем количество для фоновой обработки
    const limitedPoints = pointsToImprove.slice(0, 100);
    let improvedCount = 0;
    
    for (let i = 0; i < limitedPoints.length; i++) {
        const point = limitedPoints[i];
        
        try {
            // Используем улучшенный алгоритм
            const newCoords = await smartGeocodePoint(point);
            
            // Если координаты изменились и стали более точными
            if (newCoords.lat !== point.lat || newCoords.lng !== point.lng) {
                if (!newCoords.isMock || (point.isMock && newCoords.geocodingSource !== 'approximate')) {
                    point.lat = newCoords.lat;
                    point.lng = newCoords.lng;
                    point.coordinates = `${newCoords.lat},${newCoords.lng}`;
                    point.isMock = newCoords.isMock;
                    point.geocodingSource = newCoords.geocodingSource;
                    improvedCount++;
                    
                    // Обновляем маркер на карте
                    updateMarkerOnMap(point);
                }
            }
            
            // Задержка для API лимитов
            await sleep(2000);
            
        } catch (error) {
            console.warn('Фоновое улучшение не удалось для:', point.name);
        }
        
        // Обновляем прогресс
        if (i % 10 === 0) {
            updateStatus(`Фоновое улучшение: ${i}/${limitedPoints.length} (${improvedCount} улучшено)`);
        }
    }
    
    updateStatus(`Готово. ${improvedCount} точек улучшено`);
    updateRegionStats();
    
    if (improvedCount > 0) {
        showNotification(`Фоновое улучшение: ${improvedCount} точек стало точнее`, 'success');
    }
}

// ========== ДОБАВЛЕНИЕ РАСШИРЕННОЙ ИНФОРМАЦИИ В ФИЛЬТРЫ ==========
function updateFilters() {
    // Собираем уникальные значения с учетом регионов
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set(),
        cities: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project) filters.projects.add(point.project);
        if (point.region) {
            const normalizedRegion = normalizeRegion(point.region);
            if (normalizedRegion) filters.regions.add(normalizedRegion);
        }
        if (point.status) filters.statuses.add(point.status);
        if (point.manager) filters.managers.add(point.manager);
        if (point.city) filters.cities.add(point.city);
    });
    
    // Заполняем select'ы
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
    
    // Добавляем фильтр по городам если его нет
    addCityFilter(Array.from(filters.cities).sort());
}

function addCityFilter(cities) {
    const filtersContainer = document.querySelector('.filters');
    if (!filtersContainer) return;
    
    // Проверяем, есть ли уже фильтр городов
    if (!document.getElementById('filter-city')) {
        const cityFilterHTML = `
            <div class="filter-group">
                <label><i class="fas fa-city"></i> Город:</label>
                <select id="filter-city" multiple class="filter-select">
                    <option value="">Все города</option>
                </select>
            </div>
        `;
        
        // Вставляем перед кнопкой применения фильтров
        const applyButton = filtersContainer.querySelector('.btn');
        if (applyButton) {
            applyButton.insertAdjacentHTML('beforebegin', cityFilterHTML);
        }
    }
    
    // Заполняем фильтр городов
    fillFilter('filter-city', cities);
}

// ========== ИНФОРМАЦИЯ О ТОЧКЕ С РАСШИРЕННЫМИ ДАННЫМИ ==========
function showPointDetails(point) {
    const container = document.getElementById('point-details');
    const infoSection = document.getElementById('point-info');
    
    // Определяем цвет статуса
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    }
    
    // Информация о геокодировании
    let geocodingInfo = '';
    if (point.geocodingSource) {
        let sourceText = '';
        let qualityText = '';
        
        switch (point.geocodingSource) {
            case 'local_db':
                sourceText = 'Локальная база данных';
                qualityText = 'Высокая точность';
                break;
            case 'nominatim':
            case 'nominatim_region':
                sourceText = 'OpenStreetMap';
                qualityText = 'Высокая точность';
                break;
            case 'region_city':
                sourceText = 'Региональный центр города';
                qualityText = 'Средняя точность';
                break;
            case 'region_center':
                sourceText = 'Центр региона';
                qualityText = 'Низкая точность';
                break;
            case 'approximate':
                sourceText = 'Приблизительное определение';
                qualityText = 'Низкая точность';
                break;
            case 'fallback':
                sourceText = 'Резервный алгоритм';
                qualityText = 'Очень низкая точность';
                break;
            case 'cache':
                sourceText = 'Кэш';
                qualityText = point.isMock ? 'Средняя точность' : 'Высокая точность';
                break;
            default:
                sourceText = point.geocodingSource;
                qualityText = point.isMock ? 'Низкая точность' : 'Высокая точность';
        }
        
        geocodingInfo = `
            <div style="margin-top: 10px; font-size: 11px; color: #95a5a6;">
                <i class="fas fa-map-marked-alt"></i> Источник: ${sourceText}<br>
                <i class="fas fa-bullseye"></i> Точность: ${qualityText}
            </div>
        `;
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 5px;">${point.name || 'Без названия'}</h5>
            <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                ${point.status || 'Статус не указан'}
            </span>
            ${point.isMock ? '<span style="color: #f39c12; font-size: 11px; margin-left: 10px;"><i class="fas fa-exclamation-triangle"></i> приблизительно</span>' : ''}
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
            ${point.address ? `
                <p><strong>Адрес:</strong> ${point.address}</p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p><strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</p>
            ` : ''}
            
            ${point.region ? `
                <p><strong>Регион:</strong> ${point.region}</p>
            ` : ''}
            
            ${point.city ? `
                <p><strong>Город:</strong> ${point.city}</p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
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
        
        ${geocodingInfo}
        
        ${point.isMock ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты<br>
                <small>Будет уточнено в фоновом режиме</small>
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========== ОБНОВЛЕНИЕ ОСТАЛЬНЫХ ФУНКЦИЙ ==========
function applyFilters() {
    // Получаем выбранные значения (включая город)
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    activeFilters.cities = getSelectedValues('filter-city') || [];
    
    // Показываем отфильтрованные точки
    showPointsOnMap();
    
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    // Сбрасываем все select'ы
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager', 'filter-city'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.selectedIndex = 0;
        }
    });
    
    // Сбрасываем активные фильтры
    activeFilters = {
        projects: [],
        regions: [],
        statuses: [],
        managers: [],
        cities: []
    };
    
    // Показываем все точки
    showPointsOnMap();
    
    showNotification('Фильтры сброшены', 'success');
}

function filterPoints() {
    return allPoints.filter(point => {
        // Проверяем каждый фильтр
        const filters = [
            { key: 'project', value: point.project, active: activeFilters.projects },
            { key: 'region', value: normalizeRegion(point.region), active: activeFilters.regions },
            { key: 'status', value: point.status, active: activeFilters.statuses },
            { key: 'manager', value: point.manager, active: activeFilters.managers },
            { key: 'city', value: point.city, active: activeFilters.cities }
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
}

// ========== ИМПОРТ УТИЛИТ ИЗ ПРЕДЫДУЩЕЙ ВЕРСИИ ==========
// Функции loadDataAsCSV, processData, findColumnIndices, showPointsOnMap,
// createMarker, updateMarkerOnMap, createPopupContent, updateStatistics,
// updateLegend, setupAutoUpdate, updateStatus, showModal, updateModal,
// closeModal, showNotification, sleep остаются без изменений из предыдущей версии

// Добавьте их из предыдущего кода, я оставил только измененные функции

// ========== ОСТАЛЬНЫЙ КОД (из предыдущей версии) ==========
// Вставьте сюда остальные функции из предыдущей версии app.js,
// которые не были изменены в этом обновлении

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.improveGeocoding = backgroundSmartGeocoding; // Переименовали функцию
