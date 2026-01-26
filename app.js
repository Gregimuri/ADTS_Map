[file name]: app.js
[file content begin]
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
let isGeocoding = false;
let geocodingCache = {};
let geocodingStats = {
    total: 0,
    cached: 0,
    queued: 0,
    processing: 0,
    success: 0,
    failed: 0
};

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    loadGeocodingCache();
    loadData();
    setupAutoUpdate();
    setupGeocodingWorker();
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

// ========== УЛУЧШЕННОЕ ГЕОКОДИРОВАНИЕ ==========
async function loadGeocodingCache() {
    try {
        const cached = localStorage.getItem('geocoding_cache');
        if (cached) {
            geocodingCache = JSON.parse(cached);
            console.log(`Загружен кэш геокодирования: ${Object.keys(geocodingCache).length} записей`);
        }
    } catch (error) {
        console.error('Ошибка загрузки кэша:', error);
    }
}

function saveGeocodingCache() {
    try {
        localStorage.setItem('geocoding_cache', JSON.stringify(geocodingCache));
        console.log(`Кэш сохранен: ${Object.keys(geocodingCache).length} записей`);
    } catch (error) {
        console.error('Ошибка сохранения кэша:', error);
    }
}

function normalizeAddressForGeocoding(address) {
    if (!address) return '';
    
    // Основная нормализация
    let normalized = address
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\([^)]*\)/g, '') // Удаляем комментарии в скобках
        .replace(/\d{6},?\s*/g, '') // Удаляем почтовые индексы
        .replace(/\b(торг\.? ?точка|тт|магазин|здание|помещ\.?)\b/g, '')
        .replace(/[.,]+\s*/g, ', ')
        .trim();
    
    // Стандартизируем сокращения
    const abbreviations = {
        'ул\.': 'ул',
        'улица': 'ул',
        'пр\.': 'пр-кт',
        'проспект': 'пр-кт',
        'пер\.': 'пер',
        'переулок': 'пер',
        'д\.': 'д',
        'дом': 'д',
        'г\.': 'г',
        'город': 'г',
        'обл\.': 'обл',
        'область': 'обл',
        'респ\.': 'респ',
        'республика': 'респ',
        'край': 'край'
    };
    
    Object.keys(abbreviations).forEach(abbr => {
        const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
        normalized = normalized.replace(regex, abbreviations[abbr]);
    });
    
    // Убираем лишние запятые
    normalized = normalized.replace(/,+/g, ',')
        .replace(/^,/, '')
        .replace(/,$/, '')
        .trim();
    
    return normalized;
}

function getAddressKey(address, region = '') {
    // Создаем ключ для кэширования
    const key = `${normalizeAddressForGeocoding(address)}|${region}`.toLowerCase();
    return key.replace(/\s+/g, ' ').trim();
}

async function geocodeAddress(address, region = '') {
    const cacheKey = getAddressKey(address, region);
    
    // Проверяем кэш
    if (geocodingCache[cacheKey]) {
        const cached = geocodingCache[cacheKey];
        // Проверяем срок действия кэша (30 дней)
        if (Date.now() - cached.timestamp < 30 * 24 * 60 * 60 * 1000) {
            geocodingStats.cached++;
            return cached.coords;
        }
    }
    
    // Если в кэше нет, добавляем в очередь для фонового геокодирования
    if (!geocodingQueue.some(item => item.key === cacheKey)) {
        geocodingQueue.push({
            key: cacheKey,
            address: address,
            region: region,
            timestamp: Date.now()
        });
        geocodingStats.queued++;
        updateGeocodingStatus();
    }
    
    // Возвращаем приблизительные координаты по региону
    return getEstimatedCoordinates(region);
}

function getEstimatedCoordinates(region = '') {
    // Координаты по регионам России
    const regionCoordinates = {
        // Центральный федеральный округ
        'москва': { lat: 55.7558, lng: 37.6173, radius: 0.2 },
        'московская': { lat: 55.7539, lng: 37.6208, radius: 1.0 },
        'тульская': { lat: 54.1931, lng: 37.6173, radius: 1.0 },
        'брянская': { lat: 53.2434, lng: 34.3634, radius: 1.0 },
        'владимирская': { lat: 56.1291, lng: 40.4066, radius: 1.0 },
        
        // Северо-Западный федеральный округ
        'санкт-петербург': { lat: 59.9343, lng: 30.3351, radius: 0.2 },
        'ленинградская': { lat: 59.9343, lng: 30.3351, radius: 1.0 },
        'архангельская': { lat: 64.5401, lng: 40.5433, radius: 2.0 },
        'карелия': { lat: 61.7850, lng: 34.3468, radius: 2.0 },
        
        // Приволжский федеральный округ
        'нижегородская': { lat: 56.3269, lng: 44.0065, radius: 1.5 },
        'татарстан': { lat: 55.7944, lng: 49.1115, radius: 1.5 },
        'башкортостан': { lat: 54.7351, lng: 55.9587, radius: 1.5 },
        'самарская': { lat: 53.1959, lng: 50.1002, radius: 1.5 },
        
        // Сибирский федеральный округ
        'алтайский': { lat: 53.3481, lng: 83.7794, radius: 2.0 },
        'красноярский': { lat: 56.0153, lng: 92.8932, radius: 3.0 },
        'кемеровская': { lat: 55.3547, lng: 86.0873, radius: 1.5 },
        'иркутская': { lat: 52.2864, lng: 104.2807, radius: 2.0 },
        
        // Уральский федеральный округ
        'свердловская': { lat: 56.8389, lng: 60.6057, radius: 1.5 },
        'челябинская': { lat: 55.1644, lng: 61.4368, radius: 1.5 },
        'тюменская': { lat: 57.1530, lng: 65.5343, radius: 2.0 },
        
        // Другие регионы
        'ростовская': { lat: 47.2224, lng: 39.7187, radius: 1.5 },
        'краснодарский': { lat: 45.0355, lng: 38.9753, radius: 1.5 },
        'волгоградская': { lat: 48.7080, lng: 44.5133, radius: 1.5 }
    };
    
    // Ищем регион в списке
    let baseCoords = { lat: 55.7558, lng: 37.6173, radius: 2.0 }; // Москва по умолчанию
    
    if (region) {
        const regionLower = region.toLowerCase();
        for (const [key, coords] of Object.entries(regionCoordinates)) {
            if (regionLower.includes(key)) {
                baseCoords = coords;
                break;
            }
        }
    }
    
    // Генерируем случайные координаты в радиусе региона
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * baseCoords.radius;
    
    const lat = baseCoords.lat + (Math.cos(angle) * radius) / 111; // 1 градус ≈ 111 км
    const lng = baseCoords.lng + (Math.sin(angle) * radius) / (111 * Math.cos(baseCoords.lat * Math.PI / 180));
    
    return {
        lat: parseFloat(lat.toFixed(6)),
        lng: parseFloat(lng.toFixed(6)),
        accuracy: 'estimated',
        source: 'estimation',
        timestamp: Date.now()
    };
}

async function processGeocodingQueue() {
    if (isGeocoding || geocodingQueue.length === 0) {
        return;
    }
    
    isGeocoding = true;
    geocodingStats.processing = geocodingQueue.length;
    
    console.log(`Начинаю фоновое геокодирование ${geocodingQueue.length} адресов...`);
    
    // Создаем копию очереди для обработки
    const queueCopy = [...geocodingQueue];
    geocodingQueue = [];
    
    // Ограничиваем количество одновременных запросов
    const BATCH_SIZE = 3;
    const DELAY_BETWEEN_REQUESTS = 1000;
    
    for (let i = 0; i < queueCopy.length; i += BATCH_SIZE) {
        const batch = queueCopy.slice(i, i + BATCH_SIZE);
        
        // Обрабатываем батч параллельно
        const promises = batch.map(async (item) => {
            try {
                // Пробуем геокодировать через OpenStreetMap (без API ключа)
                const coords = await geocodeWithOSM(item.address, item.region);
                
                if (coords) {
                    // Сохраняем в кэш
                    geocodingCache[item.key] = {
                        coords: {
                            lat: coords.lat,
                            lng: coords.lng,
                            accuracy: 'exact',
                            source: 'osm',
                            timestamp: Date.now()
                        },
                        timestamp: Date.now()
                    };
                    
                    geocodingStats.success++;
                    
                    // Обновляем точки на карте с новыми координатами
                    updatePointsWithNewCoordinates(item.key, coords);
                    
                    return true;
                }
            } catch (error) {
                console.warn('Ошибка геокодирования:', error);
            }
            
            geocodingStats.failed++;
            return false;
        });
        
        // Ждем завершения батча
        await Promise.all(promises);
        
        // Сохраняем кэш
        saveGeocodingCache();
        updateGeocodingStatus();
        
        // Задержка между батчами
        if (i + BATCH_SIZE < queueCopy.length) {
            await sleep(DELAY_BETWEEN_REQUESTS);
        }
    }
    
    isGeocoding = false;
    console.log('Фоновое геокодирование завершено');
}

async function geocodeWithOSM(address, region = '') {
    try {
        // Нормализуем адрес для OSM
        let query = normalizeAddressForGeocoding(address);
        if (region) {
            query += `, ${region}`;
        }
        query += ', Россия';
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=ru&accept-language=ru`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TTMapApp/1.0',
                'Referer': 'https://tt-map.example.com',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            }
        });
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                display_name: data[0].display_name
            };
        }
    } catch (error) {
        console.error('OSM геокодирование ошибка:', error);
    }
    
    return null;
}

function updatePointsWithNewCoordinates(cacheKey, exactCoords) {
    // Находим все точки с приблизительными координатами для этого адреса
    allPoints.forEach(point => {
        if (point.address && getAddressKey(point.address, point.region) === cacheKey) {
            if (point.coordinates && point.coordinates.includes('estimated')) {
                // Обновляем координаты
                point.lat = exactCoords.lat;
                point.lng = exactCoords.lng;
                point.coordinates = `${exactCoords.lat},${exactCoords.lng}`;
                point.isMock = false;
                point.coordinatesSource = 'osm';
                point.coordinatesUpdated = new Date().toISOString();
                
                console.log(`Обновлены координаты для: ${point.name || point.address}`);
                
                // Обновляем маркер на карте
                updateMarkerCoordinates(point);
            }
        }
    });
}

function updateMarkerCoordinates(point) {
    // Находим и обновляем маркер на карте
    markerCluster.eachLayer(function(layer) {
        if (layer.options && layer.options.id === point.id) {
            // Создаем новый маркер с обновленными координатами
            const newMarker = createMarker(point);
            
            // Удаляем старый и добавляем новый
            markerCluster.removeLayer(layer);
            markerCluster.addLayer(newMarker);
            
            // Показываем уведомление о перемещении
            showNotification(`Координаты уточнены: ${point.name || 'Точка'}`, 'success');
        }
    });
}

function updateGeocodingStatus() {
    const statusElement = document.getElementById('geocoding-status');
    if (!statusElement) {
        // Создаем элемент статуса если его нет
        const sidebar = document.querySelector('.sidebar');
        const statusDiv = document.createElement('div');
        statusDiv.id = 'geocoding-status';
        statusDiv.className = 'geocoding-status';
        statusDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-sync-alt fa-spin"></i>
                <span>Геокодирование...</span>
                <span id="geocoding-progress">0/0</span>
            </div>
        `;
        sidebar.appendChild(statusDiv);
    }
    
    const progressElement = document.getElementById('geocoding-progress');
    if (progressElement) {
        const total = geocodingStats.queued + geocodingStats.processing;
        const processed = geocodingStats.success + geocodingStats.failed;
        progressElement.textContent = `${processed}/${total}`;
    }
}

function setupGeocodingWorker() {
    // Запускаем периодическую проверку очереди геокодирования
    setInterval(() => {
        if (geocodingQueue.length > 0 && !isGeocoding) {
            processGeocodingQueue();
        }
    }, 10000); // Проверяем каждые 10 секунд
    
    // Также запускаем сразу если есть очередь
    if (geocodingQueue.length > 0) {
        setTimeout(() => processGeocodingQueue(), 5000);
    }
}

// ========== ЗАГРУЗКА ДАННЫХ ИЗ GOOGLE SHEETS ==========
async function loadData() {
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        // 1. Загружаем данные как CSV (простой способ)
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        // 2. Обрабатываем данные
        allPoints = processData(data);
        
        // 3. Добавляем координаты (с улучшенным геокодированием)
        allPoints = await addCoordinatesWithGeocoding(allPoints);
        
        // 4. Обновляем интерфейс
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // 5. Запускаем фоновое геокодирование для уточнения координат
        startBackgroundGeocoding();
        
        // 6. Скрываем модальное окно
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        
        showNotification('Данные успешно загружены', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        // Пробуем альтернативный метод
        setTimeout(tryAlternativeLoad, 5000);
    }
}

async function addCoordinatesWithGeocoding(points) {
    console.log('Добавление координат с геокодированием для', points.length, 'точек...');
    
    const updatedPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        // Показываем прогресс
        if (i % 10 === 0) {
            updateModal('Геокодирование', `Обработано ${i} из ${points.length} адресов...`);
        }
        
        // Если есть адрес
        if (point.address) {
            try {
                // Пытаемся получить координаты (из кэша или через геокодирование)
                const coords = await geocodeAddress(point.address, point.region);
                
                if (coords) {
                    point.lat = coords.lat;
                    point.lng = coords.lng;
                    point.coordinates = `${coords.lat},${coords.lng}`;
                    point.coordinatesSource = coords.source;
                    point.coordinatesAccuracy = coords.accuracy;
                    point.coordinatesTimestamp = coords.timestamp;
                    
                    if (coords.accuracy === 'estimated') {
                        point.isMock = true;
                        point.coordinatesStatus = 'estimated';
                    } else {
                        point.isMock = false;
                        point.coordinatesStatus = 'exact';
                    }
                } else {
                    // Если даже приблизительные координаты не получены
                    point.lat = getRandomCoordinate('lat', point.region);
                    point.lng = getRandomCoordinate('lng', point.region);
                    point.coordinates = `${point.lat},${point.lng}`;
                    point.isMock = true;
                    point.coordinatesStatus = 'random';
                    point.coordinatesSource = 'random';
                }
                
            } catch (error) {
                console.warn('Ошибка геокодирования:', error);
                point.lat = getRandomCoordinate('lat', point.region);
                point.lng = getRandomCoordinate('lng', point.region);
                point.coordinates = `${point.lat},${point.lng}`;
                point.isMock = true;
                point.coordinatesStatus = 'error';
                point.coordinatesSource = 'error';
            }
        } else {
            // Случайные координаты
            point.lat = getRandomCoordinate('lat', point.region);
            point.lng = getRandomCoordinate('lng', point.region);
            point.coordinates = `${point.lat},${point.lng}`;
            point.isMock = true;
            point.coordinatesStatus = 'no_address';
            point.coordinatesSource = 'random';
        }
        
        // Добавляем уникальный ID если нет
        if (!point.id) {
            point.id = `point_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
        }
        
        updatedPoints.push(point);
    }
    
    return updatedPoints;
}

function startBackgroundGeocoding() {
    // Собираем адреса, которые нуждаются в уточнении
    const addressesToRefine = allPoints.filter(point => 
        point.address && 
        point.coordinatesAccuracy === 'estimated' &&
        !geocodingQueue.some(item => getAddressKey(point.address, point.region) === item.key)
    );
    
    if (addressesToRefine.length > 0) {
        console.log(`Найдено ${addressesToRefine.length} адресов для уточнения координат`);
        
        // Добавляем в очередь геокодирования
        addressesToRefine.forEach(point => {
            const cacheKey = getAddressKey(point.address, point.region);
            geocodingQueue.push({
                key: cacheKey,
                address: point.address,
                region: point.region,
                timestamp: Date.now()
            });
        });
        
        geocodingStats.queued = geocodingQueue.length;
        updateGeocodingStatus();
        
        // Запускаем обработку очереди
        if (!isGeocoding) {
            setTimeout(() => processGeocodingQueue(), 3000);
        }
    }
}

function getRandomCoordinate(type, region) {
    // Используем улучшенную функцию из геокодирования
    const estimated = getEstimatedCoordinates(region);
    return type === 'lat' ? estimated.lat : estimated.lng;
}

// ========== ОСТАЛЬНОЙ КОД ОСТАЕТСЯ БЕЗ ИЗМЕНЕНИЙ ==========

// ========== АЛЬТЕРНАТИВНЫЙ СПОСОБ ЗАГРУЗКИ ==========
async function tryAlternativeLoad() {
    try {
        updateStatus('Пробуем альтернативный способ...');
        
        // Используем Google Sheets CSV экспорт
        const csvUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv`;
        
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
        
        allPoints = await addCoordinatesWithGeocoding(points);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // Запускаем фоновое геокодирование
        startBackgroundGeocoding();
        
        updateStatus(`Загружено: ${allPoints.length} точек`);
        showNotification('Данные загружены через CSV', 'success');
        
    } catch (error) {
        console.error('Ошибка альтернативной загрузки:', error);
        showNotification('Не удалось загрузить данные. Проверьте доступ к таблице.', 'error');
        
        // Показываем демо-данные для теста
        showDemoData();
    }
}

// ========== ЗАГРУЗКА ДАННЫХ КАК CSV ==========
async function loadDataAsCSV() {
    // Формируем URL для экспорта всей книги как CSV
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&id=${CONFIG.SPREADSHEET_ID}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        
        // Простой парсинг CSV
        const rows = csvText.split('\n').map(row => {
            // Обрабатываем строки с запятыми внутри кавычек
            const result = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < row.length; i++) {
                const char = row[i];
                
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            
            result.push(current.trim());
            return result.map(cell => cell.replace(/^"|"$/g, ''));
        }).filter(row => row.length > 1 && row.some(cell => cell.trim() !== ''));
        
        return rows;
        
    } catch (error) {
        console.error('Ошибка загрузки CSV:', error);
        return null;
    }
}

// ========== ОБРАБОТКА ДАННЫХ ==========
function processData(rows) {
    if (!rows || rows.length < 2) return [];
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    // Находим индексы столбцов
    const colIndices = findColumnIndices(headers);
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        // Пропускаем пустые строки
        if (!row || row.length === 0 || row.every(cell => !cell || cell.toString().trim() === '')) {
            continue;
        }
        
        // Создаем точку
        const point = {
            id: `point_${Date.now()}_${i}`,
            sheetRow: i + 1
        };
        
        // Заполняем данные
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && row[index]) {
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
        
        if (point.name) {
            points.push(point);
        }
    }
    
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
        
        // Название
        if (indices.name === -1) {
            for (const name of CONFIG.COLUMN_NAMES.name) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.name = index;
                    break;
                }
            }
        }
        
        // Регион
        if (indices.region === -1) {
            for (const name of CONFIG.COLUMN_NAMES.region) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.region = index;
                    break;
                }
            }
        }
        
        // Адрес
        if (indices.address === -1) {
            for (const name of CONFIG.COLUMN_NAMES.address) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.address = index;
                    break;
                }
            }
        }
        
        // Статус
        if (indices.status === -1) {
            for (const name of CONFIG.COLUMN_NAMES.status) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.status = index;
                    break;
                }
            }
        }
        
        // Менеджер
        if (indices.manager === -1) {
            for (const name of CONFIG.COLUMN_NAMES.manager) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.manager = index;
                    break;
                }
            }
        }
        
        // Подрядчик
        if (indices.contractor === -1) {
            for (const name of CONFIG.COLUMN_NAMES.contractor) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.contractor = index;
                    break;
                }
            }
        }
    });
    
    return indices;
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
            coordinatesStatus: 'exact',
            coordinatesSource: 'demo'
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
            coordinatesStatus: 'exact',
            coordinatesSource: 'demo'
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
            coordinatesStatus: 'estimated',
            coordinatesSource: 'estimation'
        }
    ];
    
    updateFilters();
    updateStatistics();
    updateLegend();
    showPointsOnMap();
    
    // Запускаем фоновое геокодирование для демо-точки
    startBackgroundGeocoding();
    
    updateStatus('Демо-данные загружены');
    showNotification('Используются демо-данные. Проверьте доступ к таблице.', 'warning');
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК НА КАРТЕ ==========
function showPointsOnMap() {
    // Очищаем старые маркеры
    markerCluster.clearLayers();
    
    // Фильтруем точки
    const filteredPoints = filterPoints();
    
    // Добавляем маркеры
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
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
    }
    
    updateStatistics();
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
    
    // Определяем иконку в зависимости от точности координат
    let markerIcon = 'map-marker-alt';
    let markerStyle = '';
    
    if (point.isMock) {
        if (point.coordinatesStatus === 'estimated') {
            markerIcon = 'location-arrow';
            markerStyle = 'border: 2px dashed #f39c12;';
            color = '#f39c12'; // Оранжевый для приблизительных
        } else {
            markerIcon = 'question-circle';
            markerStyle = 'border: 2px dotted #95a5a6;';
            color = '#95a5a6'; // Серый для случайных
        }
    }
    
    const icon = L.divIcon({
        html: `
            <div style="
                background: ${color};
                width: 30px;
                height: 30px;
                border-radius: 50%;
                border: 3px solid white;
                ${markerStyle}
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 12px;
                position: relative;
            " title="${point.coordinatesAccuracy === 'estimated' ? 'Приблизительные координаты' : 'Точные координаты'}">
                <i class="fas fa-${markerIcon}" style="font-size: 14px;"></i>
                ${point.coordinatesAccuracy === 'estimated' ? 
                    '<div style="position: absolute; top: -5px; right: -5px; background: #f39c12; color: white; width: 12px; height: 12px; border-radius: 50%; font-size: 8px; display: flex; align-items: center; justify-content: center;">~</div>' : 
                    ''}
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
        id: point.id
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
    
    // Определяем источник координат
    let coordinatesSource = 'Неизвестно';
    if (point.coordinatesSource === 'osm') {
        coordinatesSource = 'OpenStreetMap';
    } else if (point.coordinatesSource === 'estimation') {
        coordinatesSource = 'Приблизительные (по региону)';
    } else if (point.coordinatesSource === 'random') {
        coordinatesSource = 'Случайные';
    } else if (point.coordinatesSource === 'demo') {
        coordinatesSource = 'Демо-данные';
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
            
            <div style="margin-top: 10px; padding: 8px; background: #f8f9fa; border-radius: 5px; font-size: 11px;">
                <strong>Координаты:</strong> ${point.lat?.toFixed(6)}, ${point.lng?.toFixed(6)}<br>
                <strong>Источник:</strong> ${coordinatesSource}<br>
                <strong>Точность:</strong> ${point.coordinatesAccuracy === 'estimated' ? 'Приблизительные' : 'Точные'}
                ${point.coordinatesUpdated ? `<br><strong>Обновлено:</strong> ${new Date(point.coordinatesUpdated).toLocaleString()}` : ''}
            </div>
            
            ${point.isMock ? `
                <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px;">
                    <i class="fas fa-exclamation-triangle"></i> Координаты будут уточнены в фоновом режиме
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========
function updateFilters() {
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
    
    // Заполняем select'ы
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
}

function fillFilter(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
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
}

function applyFilters() {
    // Получаем выбранные значения
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    // Показываем отфильтрованные точки
    showPointsOnMap();
    
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
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
    return allPoints.filter(point => {
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
    
    // Ищем точки
    const results = allPoints.filter(point => {
        return (
            (point.name && point.name.toLowerCase().includes(query)) ||
            (point.address && point.address.toLowerCase().includes(query)) ||
            (point.region && point.region.toLowerCase().includes(query)) ||
            (point.manager && point.manager.toLowerCase().includes(query))
        );
    });
    
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
    
    // Определяем цвет статуса
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    }
    
    // Определяем иконку точности координат
    let accuracyIcon = '';
    let accuracyText = '';
    if (point.coordinatesAccuracy === 'estimated') {
        accuracyIcon = '<i class="fas fa-location-arrow"></i>';
        accuracyText = 'Приблизительные координаты (уточняются в фоне)';
    } else if (point.isMock) {
        accuracyIcon = '<i class="fas fa-question-circle"></i>';
        accuracyText = 'Неточные координаты';
    } else {
        accuracyIcon = '<i class="fas fa-check-circle"></i>';
        accuracyText = 'Точные координаты';
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
                <p><strong>Точность:</strong> ${accuracyIcon} ${accuracyText}</p>
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
        
        ${point.coordinatesAccuracy === 'estimated' ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-sync-alt fa-spin"></i> Координаты уточняются в фоновом режиме
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
    
    const exactCoordinates = allPoints.filter(p => !p.isMock).length;
    const estimatedCoordinates = allPoints.filter(p => p.isMock && p.coordinatesAccuracy === 'estimated').length;
    const randomCoordinates = allPoints.filter(p => p.isMock && p.coordinatesAccuracy !== 'estimated').length;
    
    document.getElementById('total-points').textContent = allPoints.length;
    document.getElementById('shown-points').textContent = shownPoints;
    
    // Обновляем статистику геокодирования если есть элемент
    const geocodingStatsElement = document.getElementById('geocoding-stats');
    if (geocodingStatsElement) {
        geocodingStatsElement.innerHTML = `
            <div style="font-size: 12px; color: #95a5a6;">
                📍 Точные: ${exactCoordinates} | ~ Приблизительные: ${estimatedCoordinates} | ? Случайные: ${randomCoordinates}
            </div>
        `;
    }
}

function updateLegend() {
    const container = document.getElementById('legend');
    
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
    
    // Создаем элементы легенды для статусов
    legendHTML += '<h6 style="margin-bottom: 10px;">Статусы:</h6>';
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
    
    // Легенда для точности координат
    legendHTML += `
        <hr style="margin: 15px 0; border-color: #4a6572;">
        <h6 style="margin-bottom: 10px;">Точность координат:</h6>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <div style="width: 15px; height: 15px; border-radius: 50%; background: #2ecc71; border: 2px solid white;"></div>
            <span style="font-size: 12px;">Точные координаты</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <div style="width: 15px; height: 15px; border-radius: 50%; background: #f39c12; border: 2px dashed #f39c12;"></div>
            <span style="font-size: 12px;">Приблизительные (уточняются)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <div style="width: 15px; height: 15px; border-radius: 50%; background: #95a5a6; border: 2px dotted #95a5a6;"></div>
            <span style="font-size: 12px;">Случайные координаты</span>
        </div>
    `;
    
    container.innerHTML = legendHTML;
}

// ========== АВТООБНОВЛЕНИЕ ==========
function setupAutoUpdate() {
    if (CONFIG.UPDATE.auto) {
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
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal').style.display = 'flex';
}

function updateModal(title, message) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

function showNotification(message, type = 'info') {
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
        ">
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Удаляем через 5 секунд
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }
    }, 5000);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
[file content end]
