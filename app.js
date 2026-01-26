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
let geocodingQueue = [];
let isGeocodingActive = false;
let geocodingCache = new Map();
let markersMap = new Map();
let isLoading = false;

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM загружен, инициализируем карту...');
    initMap();
    loadGeocodingCache();
    
    // Показываем демо-данные сразу, пока загружаются реальные
    showDemoData();
    
    // Загружаем реальные данные
    loadData();
    setupAutoUpdate();
    setupGeocodingWorker();
});

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
    console.log('Инициализация карты...');
    
    // Проверяем наличие элемента карты
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
        
        console.log('Карта успешно инициализирована');
    } catch (error) {
        console.error('Ошибка инициализации карты:', error);
        showNotification('Ошибка загрузки карты', 'error');
    }
}

// ========== ЗАГРУЗКА ДАННЫХ ИЗ GOOGLE SHEETS ==========
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
        
        // 1. Пробуем загрузить данные через CSV
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            console.warn('Не удалось загрузить данные через CSV, пробую альтернативный метод...');
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Данные загружены: ${data.length} строк`);
        
        // 2. Обрабатываем данные
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
        // 3. Добавляем координаты (быстро, с использованием кэша)
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`Координаты добавлены: ${allPoints.length}`);
        
        // 4. Обновляем интерфейс
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // 5. Начинаем фоновое геокодирование для уточнения координат
        if (CONFIG.GEOCODING.enabled && CONFIG.GEOCODING.autoUpdate) {
            startBackgroundGeocoding();
        }
        
        // 6. Скрываем модальное окно
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        
        showNotification('Данные успешно загружены', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Используются демо-данные.', 'error');
        
        // Если есть демо-данные, показываем их
        if (allPoints.length === 0) {
            showDemoData();
        }
        
    } finally {
        isLoading = false;
    }
}

// ========== ЗАГРУЗКА ДАННЫХ КАК CSV ==========
async function loadDataAsCSV() {
    // Формируем URL для экспорта всей книги как CSV
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
        
        // Простой парсинг CSV
        const rows = parseCSV(csvText);
        console.log(`Парсинг CSV: ${rows.length} строк`);
        
        if (rows.length > 0) {
            console.log('Первая строка (заголовки):', rows[0]);
        }
        
        return rows;
        
    } catch (error) {
        console.error('Ошибка загрузки CSV:', error);
        return null;
    }
}

// Упрощенный парсинг CSV
function parseCSV(csvText) {
    try {
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const result = [];
        
        for (const line of lines) {
            // Простой парсинг - разбиваем по запятым
            // Более сложный парсинг с кавычками можно добавить позже
            const row = line.split(',').map(cell => {
                // Убираем кавычки если есть
                let cleanCell = cell.trim();
                if (cleanCell.startsWith('"') && cleanCell.endsWith('"')) {
                    cleanCell = cleanCell.substring(1, cleanCell.length - 1);
                }
                return cleanCell;
            });
            
            // Фильтруем полностью пустые строки
            if (row.some(cell => cell.trim() !== '')) {
                result.push(row);
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
        console.warn('Мало данных для обработки');
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    console.log('Заголовки:', headers);
    
    // Находим индексы столбцов
    const colIndices = findColumnIndices(headers);
    console.log('Найденные колонки:', colIndices);
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        // Пропускаем пустые строки
        if (!row || row.length === 0 || row.every(cell => !cell || cell.toString().trim() === '')) {
            continue;
        }
        
        // Создаем точку
        const point = {
            id: `point_${i}_${Date.now()}`,
            sheetRow: i + 1
        };
        
        // Заполняем данные
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length && row[index]) {
                point[key] = row[index].toString().trim();
            }
        });
        
        // Если нет названия, пробуем использовать другие поля
        if (!point.name) {
            // Ищем любое поле с данными
            for (const [key, value] of Object.entries(point)) {
                if (value && key !== 'id' && key !== 'sheetRow') {
                    point.name = value.substring(0, 30) + '...';
                    break;
                }
            }
        }
        
        // Если у точки есть название или адрес, добавляем ее
        if (point.name || point.address) {
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
    
    headers.forEach((header, index) => {
        if (!header) return;
        
        const headerLower = header.toString().toLowerCase().trim();
        console.log(`Проверяю заголовок [${index}]: "${header}" -> "${headerLower}"`);
        
        // Название
        if (indices.name === -1) {
            for (const name of CONFIG.COLUMN_NAMES.name) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.name = index;
                    console.log(`  Найдено название в колонке ${index}: "${header}"`);
                    break;
                }
            }
        }
        
        // Регион
        if (indices.region === -1) {
            for (const name of CONFIG.COLUMN_NAMES.region) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.region = index;
                    console.log(`  Найдено регион в колонке ${index}: "${header}"`);
                    break;
                }
            }
        }
        
        // Адрес
        if (indices.address === -1) {
            for (const name of CONFIG.COLUMN_NAMES.address) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.address = index;
                    console.log(`  Найдено адрес в колонке ${index}: "${header}"`);
                    break;
                }
            }
        }
        
        // Статус
        if (indices.status === -1) {
            for (const name of CONFIG.COLUMN_NAMES.status) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.status = index;
                    console.log(`  Найдено статус в колонке ${index}: "${header}"`);
                    break;
                }
            }
        }
        
        // Менеджер
        if (indices.manager === -1) {
            for (const name of CONFIG.COLUMN_NAMES.manager) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.manager = index;
                    console.log(`  Найдено менеджер в колонке ${index}: "${header}"`);
                    break;
                }
            }
        }
        
        // Подрядчик
        if (indices.contractor === -1) {
            for (const name of CONFIG.COLUMN_NAMES.contractor) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.contractor = index;
                    console.log(`  Найдено подрядчик в колонке ${index}: "${header}"`);
                    break;
                }
            }
        }
    });
    
    // Если не нашли адрес, пробуем найти в других колонках
    if (indices.address === -1) {
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i].toLowerCase();
            if (header.includes('адрес') || header.includes('местополож') || header.includes('адресс')) {
                indices.address = i;
                console.log(`  Адрес найден в альтернативной колонке ${i}: "${headers[i]}"`);
                break;
            }
        }
    }
    
    console.log('Итоговые индексы колонок:', indices);
    return indices;
}

// ========== СИСТЕМА ГЕОКОДИРОВАНИЯ ==========

// Загрузка кэша геокодирования из localStorage
function loadGeocodingCache() {
    try {
        const cached = localStorage.getItem('geocoding_cache');
        if (cached) {
            const data = JSON.parse(cached);
            const cacheTime = data.timestamp || 0;
            const cacheDays = CONFIG.GEOCODING?.cacheDays || 30;
            const maxAge = cacheDays * 24 * 60 * 60 * 1000;
            
            if (Date.now() - cacheTime < maxAge) {
                geocodingCache = new Map(Object.entries(data.cache || {}));
                console.log(`Загружен кэш геокодирования: ${geocodingCache.size} записей`);
            } else {
                console.log('Кэш геокодирования устарел, очищаем...');
                localStorage.removeItem('geocoding_cache');
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки кэша геокодирования:', error);
    }
}

// Сохранение кэша геокодирования в localStorage
function saveGeocodingCache() {
    try {
        const cacheData = {
            cache: Object.fromEntries(geocodingCache),
            timestamp: Date.now()
        };
        localStorage.setItem('geocoding_cache', JSON.stringify(cacheData));
    } catch (error) {
        console.error('Ошибка сохранения кэша геокодирования:', error);
    }
}

// Нормализация адреса
function normalizeAddress(address, region = '') {
    if (!address) return '';
    
    let cleanAddress = address.toString().trim();
    
    // Удаляем почтовый индекс
    cleanAddress = cleanAddress.replace(/^\d{6},?\s*/, '');
    cleanAddress = cleanAddress.replace(/,\s*\d{6}$/, '');
    
    // Удаляем текст в скобках
    cleanAddress = cleanAddress.replace(/\([^)]*\)/g, '');
    
    // Удаляем специальные пометки
    const stopWords = [
        'нас. пункт', 'торговая точка', 'торг точка', 'тт', 'магазин',
        'здание', 'помещение', 'пом.', 'владение', 'влад.', 'корп.', 'стр.'
    ];
    
    stopWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        cleanAddress = cleanAddress.replace(regex, '');
    });
    
    // Стандартизируем сокращения
    const replacements = {
        // Регионы
        'республика': 'респ',
        'область': 'обл',
        'автономный округ': 'ао',
        'край': 'край',
        
        // Населенные пункты
        'город': 'г',
        'поселок': 'п',
        'село': 'с',
        'деревня': 'д',
        
        // Улицы
        'улица': 'ул',
        'проспект': 'пр-кт',
        'переулок': 'пер',
        'бульвар': 'б-р',
        'шоссе': 'ш',
        
        // Номера
        'дом': 'д',
        'корпус': 'к',
        'строение': 'стр',
        'литер': 'лит'
    };
    
    Object.entries(replacements).forEach(([full, short]) => {
        const regex = new RegExp(`\\b${full}\\b`, 'gi');
        cleanAddress = cleanAddress.replace(regex, short);
    });
    
    // Удаляем лишние пробелы и запятые
    cleanAddress = cleanAddress.replace(/\s+/g, ' ');
    cleanAddress = cleanAddress.replace(/,\s*,/g, ',');
    cleanAddress = cleanAddress.replace(/^\s+|\s+$/g, '');
    cleanAddress = cleanAddress.replace(/^,|,$/g, '');
    
    // Добавляем регион если указан
    if (region && !cleanAddress.toLowerCase().includes(region.toLowerCase())) {
        cleanAddress = `${cleanAddress}, ${region}`;
    }
    
    // Добавляем страну
    if (!cleanAddress.toLowerCase().includes('россия')) {
        cleanAddress = `${cleanAddress}, Россия`;
    }
    
    return cleanAddress.trim();
}

// Генерация ключа для кэша
function getGeocodingCacheKey(address, region = '') {
    const normalized = normalizeAddress(address, region).toLowerCase();
    return btoa(encodeURIComponent(normalized)).replace(/[^a-zA-Z0-9]/g, '');
}

// Получение координат из кэша
function getCachedCoordinates(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    const cacheKey = getGeocodingCacheKey(address, region);
    const cached = geocodingCache.get(cacheKey);
    
    if (cached) {
        // Проверяем срок действия кэша
        const cacheDays = CONFIG.GEOCODING.cacheDays || 30;
        const maxAge = cacheDays * 24 * 60 * 60 * 1000;
        
        if (Date.now() - cached.timestamp < maxAge) {
            return {
                lat: cached.lat,
                lng: cached.lng,
                source: cached.source || 'cache',
                isExact: cached.isExact !== false
            };
        } else {
            // Удаляем устаревшую запись
            geocodingCache.delete(cacheKey);
        }
    }
    
    return null;
}

// Сохранение координат в кэш
function cacheCoordinates(address, region = '', lat, lng, source = 'unknown', isExact = true) {
    if (!CONFIG.GEOCODING?.enabled) return;
    
    const cacheKey = getGeocodingCacheKey(address, region);
    geocodingCache.set(cacheKey, {
        lat: lat,
        lng: lng,
        source: source,
        isExact: isExact,
        timestamp: Date.now(),
        address: address,
        region: region
    });
    
    // Периодически сохраняем кэш
    if (geocodingCache.size % 5 === 0) {
        saveGeocodingCache();
    }
}

// Геокодирование через Яндекс
async function geocodeYandex(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    try {
        const cleanAddress = normalizeAddress(address, region);
        const encodedAddress = encodeURIComponent(cleanAddress);
        
        // Используем публичный API Яндекс.Карт
        const url = `https://geocode-maps.yandex.ru/1.x/?format=json&geocode=${encodedAddress}&results=1`;
        
        console.log(`Геокодирование Яндекс: ${cleanAddress.substring(0, 50)}...`);
        
        // Ждем перед запросом
        await new Promise(resolve => setTimeout(resolve, CONFIG.GEOCODING.delay?.yandex || 300));
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TTMapApp/1.0',
                'Accept': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.response && 
                data.response.GeoObjectCollection && 
                data.response.GeoObjectCollection.featureMember && 
                data.response.GeoObjectCollection.featureMember.length > 0) {
                
                const pos = data.response.GeoObjectCollection.featureMember[0]
                    .GeoObject.Point.pos.split(' ');
                
                const lon = parseFloat(pos[0]);
                const lat = parseFloat(pos[1]);
                
                console.log(`Яндекс нашел координаты: ${lat}, ${lon}`);
                return { lat, lng: lon, source: 'yandex', isExact: true };
            }
        }
    } catch (error) {
        console.warn('Ошибка геокодирования Яндекс:', error);
    }
    
    return null;
}

// Геокодирование через Nominatim (OpenStreetMap)
async function geocodeNominatim(address, region = '') {
    if (!CONFIG.GEOCODING?.enabled) return null;
    
    try {
        const cleanAddress = normalizeAddress(address, region);
        
        console.log(`Геокодирование OSM: ${cleanAddress.substring(0, 50)}...`);
        
        // Ждем перед запросом
        await new Promise(resolve => setTimeout(resolve, CONFIG.GEOCODING.delay?.nominatim || 1000));
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanAddress)}&limit=1&countrycodes=ru&accept-language=ru`;
        
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
                
                console.log(`OSM нашел координаты: ${lat}, ${lon}`);
                return { lat, lng: lon, source: 'nominatim', isExact: true };
            }
        }
    } catch (error) {
        console.warn('Ошибка геокодирования Nominatim:', error);
    }
    
    return null;
}

// Основная функция геокодирования
async function geocodeAddress(address, region = '', pointId = null) {
    if (!CONFIG.GEOCODING?.enabled || !address) {
        return getRandomCoordinate(address, region);
    }
    
    // 1. Проверяем кэш
    const cached = getCachedCoordinates(address, region);
    if (cached) {
        console.log(`Координаты из кэша для: ${address.substring(0, 50)}...`);
        return cached;
    }
    
    // 2. Сначала Яндекс
    let result = await geocodeYandex(address, region);
    
    // 3. Если Яндекс не нашел, пробуем Nominatim
    if (!result) {
        result = await geocodeNominatim(address, region);
    }
    
    // 4. Если нашли точные координаты, сохраняем в кэш
    if (result && result.isExact) {
        cacheCoordinates(address, region, result.lat, result.lng, result.source, true);
        
        // Если у нас есть ID точки, обновляем ее координаты
        if (pointId) {
            updatePointCoordinates(pointId, result.lat, result.lng, result.source);
        }
    }
    
    // 5. Если не нашли, возвращаем случайные координаты
    if (!result) {
        result = getRandomCoordinate(address, region);
        cacheCoordinates(address, region, result.lat, result.lng, 'random', false);
    }
    
    return result;
}

// Обновление координат точки
function updatePointCoordinates(pointId, lat, lng, source = 'unknown') {
    const pointIndex = allPoints.findIndex(p => p.id === pointId);
    if (pointIndex !== -1) {
        const oldPoint = allPoints[pointIndex];
        
        // Обновляем точку
        allPoints[pointIndex] = {
            ...oldPoint,
            lat: lat,
            lng: lng,
            coordinates: `${lat},${lng}`,
            geocodingSource: source,
            isMock: false,
            geocodedAt: new Date().toISOString()
        };
        
        // Обновляем маркер на карте
        updateMarkerOnMap(pointId, allPoints[pointIndex]);
        
        // Обновляем статистику
        updateStatistics();
        
        console.log(`Обновлены координаты точки ${pointId}: ${lat}, ${lng} (источник: ${source})`);
        
        return true;
    }
    
    return false;
}

// Обновление маркера на карте
function updateMarkerOnMap(pointId, point) {
    // Находим маркер в кластере
    markerCluster.eachLayer((layer) => {
        if (layer.options && layer.options.pointId === pointId) {
            // Удаляем старый маркер
            markerCluster.removeLayer(layer);
            
            // Создаем новый маркер с обновленными координатами
            const newMarker = createMarker(point);
            markerCluster.addLayer(newMarker);
            
            // Обновляем карту
            markersMap.set(pointId, newMarker);
            
            return true;
        }
    });
}

// Получение случайных координат по региону
function getRandomCoordinate(address, region = '') {
    // Координаты по регионам
    const regionCoords = {
        'Москва': { lat: 55.7558, lng: 37.6173, radius: 0.1 },
        'Московская': { lat: 55.7558, lng: 37.6173, radius: 0.5 },
        'Санкт-Петербург': { lat: 59.9343, lng: 30.3351, radius: 0.1 },
        'Ленинградская': { lat: 59.9343, lng: 30.3351, radius: 0.5 },
        'Алтайский': { lat: 53.3481, lng: 83.7794, radius: 1.0 },
        'Архангельская': { lat: 64.5401, lng: 40.5433, radius: 1.0 },
        'Астраханская': { lat: 46.3497, lng: 48.0408, radius: 1.0 },
        'Владимирская': { lat: 56.1291, lng: 40.4066, radius: 0.5 },
        'Волгоградская': { lat: 48.7071, lng: 44.5169, radius: 0.5 },
        'Воронежская': { lat: 51.6608, lng: 39.2003, radius: 0.5 },
        'Екатеринбург': { lat: 56.8389, lng: 60.6057, radius: 0.1 },
        'Иркутская': { lat: 52.2864, lng: 104.2807, radius: 1.0 },
        'Казань': { lat: 55.7961, lng: 49.1064, radius: 0.1 },
        'Калининградская': { lat: 54.7104, lng: 20.4522, radius: 0.3 },
        'Калужская': { lat: 54.5136, lng: 36.2614, radius: 0.5 },
        'Кемеровская': { lat: 55.3547, lng: 86.0873, radius: 0.5 },
        'Краснодарский': { lat: 45.0355, lng: 38.9753, radius: 0.5 },
        'Красноярский': { lat: 56.0153, lng: 92.8932, radius: 1.0 },
        'Нижегородская': { lat: 56.2965, lng: 43.9361, radius: 0.5 },
        'Новосибирская': { lat: 55.0084, lng: 82.9357, radius: 0.5 },
        'Омская': { lat: 54.9893, lng: 73.3682, radius: 0.5 },
        'Оренбургская': { lat: 51.7682, lng: 55.0968, radius: 0.5 },
        'Пермский': { lat: 58.0105, lng: 56.2502, radius: 0.5 },
        'Ростовская': { lat: 47.2224, lng: 39.7189, radius: 0.5 },
        'Самарская': { lat: 53.1959, lng: 50.1002, radius: 0.5 },
        'Саратовская': { lat: 51.5924, lng: 45.9608, radius: 0.5 },
        'Свердловская': { lat: 56.8389, lng: 60.6057, radius: 0.5 },
        'Татарстан': { lat: 55.7961, lng: 49.1064, radius: 0.5 },
        'Тюменская': { lat: 57.1530, lng: 65.5343, radius: 0.5 },
        'Ульяновская': { lat: 54.3142, lng: 48.4031, radius: 0.5 },
        'Челябинская': { lat: 55.1644, lng: 61.4368, radius: 0.5 },
        'Ярославская': { lat: 57.6261, lng: 39.8845, radius: 0.5 },
        'default': { lat: 55.7558, lng: 37.6173, radius: 2.0 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 2.0;
    
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
    
    // Генерируем случайные координаты в радиусе региона
    const randomLat = baseLat + (Math.random() - 0.5) * radius;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 2;
    
    return {
        lat: randomLat,
        lng: randomLng,
        source: 'random',
        isExact: false,
        isMock: true
    };
}

// Быстрое добавление координат
async function addCoordinatesFast(points) {
    console.log('Быстрое добавление координат для', points.length, 'точек...');
    
    const updatedPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        // Показываем прогресс
        if (i % 20 === 0) {
            console.log(`Прогресс: ${i}/${points.length}`);
        }
        
        // Если уже есть координаты и они точные, используем их
        if (point.lat && point.lng && !point.isMock) {
            updatedPoints.push(point);
            continue;
        }
        
        // Проверяем кэш для быстрого доступа
        if (point.address) {
            const cached = getCachedCoordinates(point.address, point.region);
            
            if (cached && cached.isExact) {
                // Используем точные координаты из кэша
                point.lat = cached.lat;
                point.lng = cached.lng;
                point.coordinates = `${cached.lat},${cached.lng}`;
                point.geocodingSource = cached.source;
                point.isMock = false;
                point.cached = true;
                
                updatedPoints.push(point);
                continue;
            }
        }
        
        // Если нет точных координат, используем случайные (для быстрого отображения)
        const randomCoords = getRandomCoordinate(point.address, point.region);
        point.lat = randomCoords.lat;
        point.lng = randomCoords.lng;
        point.coordinates = `${randomCoords.lat},${randomCoords.lng}`;
        point.isMock = true;
        point.geocodingSource = 'random_initial';
        
        updatedPoints.push(point);
    }
    
    return updatedPoints;
}

// Добавление задачи в очередь геокодирования
function addToGeocodingQueue(point) {
    if (!CONFIG.GEOCODING?.enabled || !point.address || point.geocodingQueued) {
        return;
    }
    
    // Проверяем, есть ли уже точные координаты
    if (point.lat && point.lng && !point.isMock) {
        return;
    }
    
    // Помечаем точку как добавленную в очередь
    point.geocodingQueued = true;
    
    geocodingQueue.push({
        pointId: point.id,
        address: point.address,
        region: point.region,
        timestamp: Date.now(),
        priority: point.isMock ? 1 : 0
    });
    
    console.log(`Добавлено в очередь геокодирования: ${point.address?.substring(0, 50)}...`);
}

// Обработчик очереди геокодирования
async function processGeocodingQueue() {
    if (isGeocodingActive || geocodingQueue.length === 0) {
        return;
    }
    
    isGeocodingActive = true;
    
    try {
        // Сортируем очередь по приоритету
        geocodingQueue.sort((a, b) => b.priority - a.priority);
        
        // Берем первые N задач для одновременной обработки
        const maxConcurrent = CONFIG.GEOCODING?.maxConcurrent || 3;
        const tasks = geocodingQueue.splice(0, Math.min(maxConcurrent, geocodingQueue.length));
        
        console.log(`Обрабатываю ${tasks.length} задач геокодирования...`);
        
        // Обрабатываем задачи параллельно
        await Promise.allSettled(
            tasks.map(async (task) => {
                try {
                    const result = await geocodeAddress(task.address, task.region, task.pointId);
                    
                    if (result && result.isExact) {
                        console.log(`✅ Геокодирование успешно: ${task.address?.substring(0, 50)}...`);
                        
                        // Обновляем уведомление
                        showNotification(`Уточнены координаты для: ${task.address?.substring(0, 30)}...`, 'success', 3000);
                    }
                } catch (error) {
                    console.warn(`Ошибка геокодирования для ${task.pointId}:`, error);
                    
                    // Возвращаем задачу в очередь с пониженным приоритетом
                    task.priority = -1;
                    task.retryCount = (task.retryCount || 0) + 1;
                    
                    if (task.retryCount <= 3) {
                        geocodingQueue.push(task);
                    }
                }
            })
        );
        
    } catch (error) {
        console.error('Ошибка обработки очереди геокодирования:', error);
    } finally {
        isGeocodingActive = false;
        
        // Если в очереди еще есть задачи, обрабатываем следующую партию
        if (geocodingQueue.length > 0) {
            setTimeout(() => {
                processGeocodingQueue();
            }, 2000);
        } else {
            console.log('Очередь геокодирования пуста');
            
            // Финальное сохранение кэша
            saveGeocodingCache();
        }
    }
}

// Запуск обработчика геокодирования в фоне
function setupGeocodingWorker() {
    if (!CONFIG.GEOCODING?.enabled) return;
    
    // Проверяем очередь каждые 30 секунд
    setInterval(() => {
        if (geocodingQueue.length > 0 && !isGeocodingActive) {
            processGeocodingQueue();
        }
    }, 30000);
    
    console.log('Фоновое геокодирование активировано');
}

// Запуск фонового геокодирования
function startBackgroundGeocoding() {
    if (!CONFIG.GEOCODING?.enabled) return;
    
    console.log('Запуск фонового геокодирования для уточнения координат...');
    
    // Добавляем все точки с приблизительными координатами в очередь
    const pointsToGeocode = allPoints.filter(p => 
        p.address && 
        (p.isMock || !p.lat || !p.lng)
    );
    
    console.log(`Найдено ${pointsToGeocode.length} точек для уточнения координат`);
    
    pointsToGeocode.forEach(point => {
        addToGeocodingQueue(point);
    });
    
    // Запускаем обработку очереди
    if (pointsToGeocode.length > 0 && !isGeocodingActive) {
        setTimeout(() => {
            processGeocodingQueue();
        }, 3000);
    }
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК НА КАРТЕ ==========
function showPointsOnMap() {
    console.log('Показываю точки на карте...');
    
    // Очищаем старые маркеры
    markerCluster.clearLayers();
    markersMap.clear();
    
    // Фильтруем точки
    const filteredPoints = filterPoints();
    console.log(`Фильтровано точек: ${filteredPoints.length}`);
    
    // Добавляем маркеры
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        } else {
            console.warn('Точка без координат:', point);
        }
    });
    
    // Центрируем карту если есть точки
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
    // Определяем цвет по статусу
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    } else if (statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    // Добавляем индикатор точности координат
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
    
    // Всплывающее окно
    marker.bindPopup(createPopupContent(point));
    
    // Клик по маркеру
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    // Информация о точности координат
    let accuracyInfo = '';
    if (point.isMock) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        `;
    } else if (point.geocodingSource) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #2ecc71; color: white; border-radius: 3px; font-size: 11px; display: flex; align-items: center; gap: 5px;">
                <i class="fas fa-check-circle"></i> Точные координаты (${point.geocodingSource})
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
            </div>
            
            ${point.address ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address}</span>
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
    
    // Собираем уникальные значения
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
    
    console.log('Найдены фильтры:', {
        projects: filters.projects.size,
        regions: filters.regions.size,
        statuses: filters.statuses.size,
        managers: filters.managers.size
    });
    
    // Заполняем select'ы
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
    
    // Сохраняем выбранные значения
    const selected = Array.from(select.selectedOptions).map(opt => opt.value);
    
    // Очищаем и добавляем "Все"
    select.innerHTML = '<option value="">Все</option>';
    
    // Добавляем опции
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
    
    // Получаем выбранные значения
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    console.log('Активные фильтры:', activeFilters);
    
    // Показываем отфильтрованные точки
    showPointsOnMap();
    
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры...');
    
    // Сбрасываем select'ы
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
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
        managers: []
    };
    
    // Показываем все точки
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
    
    // Ищем точки
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
    
    // Показываем найденные точки
    markerCluster.clearLayers();
    
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    // Центрируем карту
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
    
    // Определяем цвет статуса
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 5px;">${point.name || 'Без названия'}</h5>
            <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                ${point.status || 'Статус не указан'}
            </span>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
            ${point.address ? `
                <p><strong>Адрес:</strong> ${point.address}</p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p><strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</p>
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
        </div>
        
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
    const totalPoints = allPoints.length;
    const exactCoords = allPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const mockCoords = allPoints.filter(p => p.isMock).length;
    const noCoords = allPoints.filter(p => !p.lat || !p.lng).length;
    
    const statsElement = document.getElementById('geocoding-stats');
    if (!statsElement) return;
    
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
        </div>
    `;
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    let legendHTML = '';
    
    // Собираем статусы из данных
    const statuses = new Set();
    allPoints.forEach(point => {
        if (point.status) {
            statuses.add(point.status);
        }
    });
    
    // Если мало статусов, добавляем стандартные
    if (statuses.size < 3) {
        statuses.add('сдан');
        statuses.add('Отправлен ФО, не принят');
        statuses.add('План');
    }
    
    // Создаем элементы легенды
    Array.from(statuses).sort().forEach(status => {
        let color = CONFIG.STATUS_COLORS[status] || CONFIG.STATUS_COLORS.default;
        const statusLower = status.toLowerCase();
        
        if (statusLower.includes('сдан') || statusLower.includes('актив')) {
            color = '#2ecc71';
        } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
            color = '#f39c12';
        } else if (statusLower.includes('закрыт')) {
            color = '#e74c3c';
        } else if (statusLower.includes('план')) {
            color = '#3498db';
        }
        
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
    // Удаляем старые уведомления
    document.querySelectorAll('.notification').forEach(el => el.remove());
    
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    // Иконка по типу
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
    
    // Удаляем через указанное время
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

// ========== ДЕМО-ДАННЫЕ ==========
function showDemoData() {
    console.log('Показываем демо-данные...');
    
    // Создаем демо-точки для теста
    allPoints = [
        {
            id: 'demo_1',
            name: 'Магнит №123',
            region: 'Москва',
            address: 'ул. Тверская, д. 1',
            status: 'сдан',
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
            status: 'сдан',
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
            status: 'сдан',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            lat: 53.3481 + (Math.random() - 0.5) * 0.5,
            lng: 83.7794 + (Math.random() - 0.5) * 1.0,
            isMock: true,
            geocodingSource: 'random'
        },
        {
            id: 'demo_4',
            name: 'Пятерочка №567',
            region: 'Санкт-Петербург',
            address: 'Невский проспект, 28',
            status: 'Активная',
            manager: 'Петров П.П.',
            contractor: 'Сидоров С.С.',
            lat: 59.9350,
            lng: 30.3250,
            isMock: false,
            geocodingSource: 'demo'
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

// ========== ФУНКЦИИ УПРАВЛЕНИЯ ГЕОКОДИРОВАНИЕМ ==========
function startManualGeocoding() {
    if (!CONFIG.GEOCODING?.enabled) {
        showNotification('Геокодирование отключено в настройках', 'warning');
        return;
    }
    
    const filteredPoints = filterPoints();
    const pointsToGeocode = filteredPoints.filter(p => 
        p.address && (p.isMock || !p.lat || !p.lng)
    );
    
    if (pointsToGeocode.length === 0) {
        showNotification('Нет точек для уточнения координат', 'info');
        return;
    }
    
    showNotification(`Начинаю уточнение координат для ${pointsToGeocode.length} точек...`, 'info');
    
    pointsToGeocode.forEach(point => {
        addToGeocodingQueue(point);
    });
    
    if (!isGeocodingActive) {
        processGeocodingQueue();
    }
}

function clearGeocodingCache() {
    if (confirm('Очистить кэш геокодирования? Все сохраненные координаты будут удалены.')) {
        geocodingCache.clear();
        localStorage.removeItem('geocoding_cache');
        showNotification('Кэш геокодирования очищен', 'success');
        
        // Перезагружаем данные для применения изменений
        setTimeout(() => {
            loadData();
        }, 1000);
    }
}

function showGeocodingStats() {
    const totalInCache = geocodingCache.size;
    const exactInCache = Array.from(geocodingCache.values()).filter(c => c.isExact).length;
    const approximateInCache = Array.from(geocodingCache.values()).filter(c => !c.isExact).length;
    
    const message = `
        <div style="text-align: left;">
            <h4>📊 Статистика геокодирования</h4>
            <p><strong>Кэш координат:</strong> ${totalInCache} записей</p>
            <p><strong>Точные координаты:</strong> ${exactInCache}</p>
            <p><strong>Приблизительные:</strong> ${approximateInCache}</p>
            <p><strong>В очереди:</strong> ${geocodingQueue.length} задач</p>
            <hr>
            <p><small>Кэш хранится ${CONFIG.GEOCODING?.cacheDays || 30} дней</small></p>
        </div>
    `;
    
    showModal('Статистика геокодирования', message);
}

// ========== АЛЬТЕРНАТИВНЫЙ СПОСОБ ЗАГРУЗКИ ==========
async function tryAlternativeLoad() {
    try {
        updateStatus('Пробуем альтернативный способ...');
        
        // Используем Google Sheets CSV экспорт
        const csvUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv`;
        
        console.log(`Альтернативная загрузка по URL: ${csvUrl}`);
        
        const response = await fetch(csvUrl);
        const csvText = await response.text();
        
        // Парсим CSV
        const rows = csvText.split('\n').filter(row => row.trim() !== '');
        
        if (rows.length < 2) {
            throw new Error('Мало данных в CSV');
        }
        
        // Первая строка - заголовки
        const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));
        
        // Данные
        const points = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i].split(',').map(cell => cell.trim().replace(/"/g, ''));
            const point = {};
            
            headers.forEach((header, index) => {
                if (row[index]) {
                    point[header] = row[index];
                }
            });
            
            if (point['Название ТТ']) {
                points.push(point);
            }
        }
        
        allPoints = await processAndGeocode(points);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // Запускаем фоновое геокодирование
        if (CONFIG.GEOCODING?.enabled && CONFIG.GEOCODING.autoUpdate) {
            startBackgroundGeocoding();
        }
        
        updateStatus(`Загружено: ${allPoints.length} точек`);
        showNotification('Данные загружены через CSV', 'success');
        
    } catch (error) {
        console.error('Ошибка альтернативной загрузки:', error);
        showNotification('Не удалось загрузить данные. Проверьте доступ к таблице.', 'error');
        
        // Если нет данных, показываем демо
        if (allPoints.length === 0) {
            showDemoData();
        }
    }
}

// ========== ОБРАБОТКА И ГЕОКОДИРОВАНИЕ ==========
async function processAndGeocode(points) {
    const processedPoints = [];
    
    for (const point of points) {
        // Стандартизируем поля
        const processedPoint = {
            id: `point_${Date.now()}_${Math.random()}`,
            name: point['Название ТТ'] || point['Магазин'] || 'Без названия',
            region: point['Регион'] || point['Область'] || '',
            address: point['Адрес'] || point['Местоположение'] || '',
            status: point['Статус ТТ'] || point['Статус'] || '',
            manager: point['Менеджер ФИО'] || point['Менеджер'] || '',
            contractor: point['Подрядчик ФИО'] || point['Подрядчик'] || ''
        };
        
        // Проверяем кэш для быстрого получения координат
        const cached = getCachedCoordinates(processedPoint.address, processedPoint.region);
        
        if (cached) {
            // Используем координаты из кэша
            processedPoint.lat = cached.lat;
            processedPoint.lng = cached.lng;
            processedPoint.coordinates = `${cached.lat},${cached.lng}`;
            processedPoint.geocodingSource = cached.source;
            processedPoint.isMock = !cached.isExact;
        } else {
            // Используем случайные координаты для быстрого отображения
            const randomCoords = getRandomCoordinate(processedPoint.address, processedPoint.region);
            processedPoint.lat = randomCoords.lat;
            processedPoint.lng = randomCoords.lng;
            processedPoint.coordinates = `${processedPoint.lat},${processedPoint.lng}`;
            processedPoint.isMock = true;
            processedPoint.geocodingSource = 'random_initial';
        }
        
        processedPoints.push(processedPoint);
    }
    
    return processedPoints;
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
