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
        
        // 1. Загружаем данные как CSV (простой способ)
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        // 2. Обрабатываем данные (без геокодирования)
        allPoints = processData(data);
        
        // 3. Быстрое добавление координат (случайные + из кэша)
        allPoints = await addCoordinates(allPoints);
        
        // 4. Сразу показываем точки на карте
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // 5. Скрываем модальное окно
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        
        showNotification('Данные успешно загружены', 'success');
        
        // 6. Запускаем фоновое геокодирование
        setTimeout(backgroundGeocoding, 3000);
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        // Пробуем альтернативный метод
        setTimeout(tryAlternativeLoad, 5000);
    }
}

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
        
        allPoints = await processAndGeocode(points);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        updateStatus(`Загружено: ${allPoints.length} точек`);
        showNotification('Данные загружены через CSV', 'success');
        
        // Запускаем фоновое геокодирование
        setTimeout(backgroundGeocoding, 3000);
        
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
        
        // Быстрое добавление координат
        if (processedPoint.address) {
            const coords = await geocodeAddress(processedPoint.address, processedPoint.region);
            if (coords) {
                processedPoint.lat = coords.lat;
                processedPoint.lng = coords.lng;
                processedPoint.coordinates = `${coords.lat},${coords.lng}`;
            } else {
                // Случайные координаты по региону
                processedPoint.lat = getRandomCoordinate('lat', processedPoint.region);
                processedPoint.lng = getRandomCoordinate('lng', processedPoint.region);
                processedPoint.coordinates = `${processedPoint.lat},${processedPoint.lng}`;
                processedPoint.isMock = true;
            }
        } else {
            // Случайные координаты
            processedPoint.lat = getRandomCoordinate('lat', processedPoint.region);
            processedPoint.lng = getRandomCoordinate('lng', processedPoint.region);
            processedPoint.coordinates = `${processedPoint.lat},${processedPoint.lng}`;
            processedPoint.isMock = true;
        }
        
        processedPoints.push(processedPoint);
    }
    
    return processedPoints;
}

// ========== ГЕОКОДИРОВАНИЕ С БАТЧИНГОМ ==========
async function addCoordinates(points) {
    console.log('Добавление координат для', points.length, 'точек...');
    
    const BATCH_SIZE = 20; // Увеличиваем размер пакета для быстрой обработки
    const updatedPoints = [];
    
    // Разбиваем на пакеты
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
        const batch = points.slice(i, i + BATCH_SIZE);
        
        // Показываем прогресс
        if (i % 100 === 0) {
            updateModal('Быстрая обработка', 
                `Подготовка точек: ${Math.min(i + BATCH_SIZE, points.length)} из ${points.length}... (${Math.round((Math.min(i + BATCH_SIZE, points.length) / points.length) * 100)}%)`);
        }
        
        // Обрабатываем пакет параллельно
        const batchPromises = batch.map(async (point) => {
            // Если уже есть координаты - пропускаем
            if (point.lat && point.lng) {
                return point;
            }
            
            // Если нет адреса - случайные координаты
            if (!point.address || point.address.trim() === '') {
                point.lat = getRandomCoordinate('lat', point.region);
                point.lng = getRandomCoordinate('lng', point.region);
                point.coordinates = `${point.lat},${point.lng}`;
                point.isMock = true;
                return point;
            }
            
            // Пробуем из кэша в первую очередь
            const cacheKey = `geocode_${point.address}_${point.region}`.replace(/[^a-z0-9]/gi, '_');
            const cached = localStorage.getItem(cacheKey);
            
            if (cached) {
                try {
                    const data = JSON.parse(cached);
                    // Кэш на 30 дней
                    if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
                        point.lat = data.result.lat;
                        point.lng = data.result.lng;
                        point.coordinates = `${point.lat},${point.lng}`;
                        return point;
                    }
                } catch (e) {
                    // Ошибка парсинга - игнорируем
                }
            }
            
            // Для большого количества точек используем быстрый метод
            if (points.length > 100) {
                // Сначала проверяем быструю базу координат
                const quickCoords = getQuickCoordinates(point.address, point.region);
                if (quickCoords) {
                    point.lat = quickCoords.lat;
                    point.lng = quickCoords.lng;
                    point.coordinates = `${point.lat},${point.lng}`;
                    
                    // Кэшируем быстрый результат
                    localStorage.setItem(cacheKey, JSON.stringify({
                        result: quickCoords,
                        timestamp: Date.now()
                    }));
                    
                    return point;
                }
                
                // Если нет в быстрой базе - случайные координаты
                point.lat = getRandomCoordinate('lat', point.region);
                point.lng = getRandomCoordinate('lng', point.region);
                point.coordinates = `${point.lat},${point.lng}`;
                point.isMock = true;
                point.needsGeocoding = true; // Помечаем для последующего геокодирования
                return point;
            }
            
            // Для небольшого количества точек делаем реальное геокодирование
            try {
                const coords = await geocodeAddress(point.address, point.region);
                if (coords) {
                    point.lat = coords.lat;
                    point.lng = coords.lng;
                    point.coordinates = `${coords.lat},${coords.lng}`;
                    
                    // Сохраняем в кэш
                    localStorage.setItem(cacheKey, JSON.stringify({
                        result: coords,
                        timestamp: Date.now()
                    }));
                } else {
                    throw new Error('Геокодирование не удалось');
                }
            } catch (error) {
                // Случайные координаты при ошибке
                point.lat = getRandomCoordinate('lat', point.region);
                point.lng = getRandomCoordinate('lng', point.region);
                point.coordinates = `${point.lat},${point.lng}`;
                point.isMock = true;
            }
            
            return point;
        });
        
        // Ожидаем завершения пакета
        const batchResults = await Promise.allSettled(batchPromises);
        
        // Обрабатываем результаты
        batchResults.forEach(result => {
            if (result.status === 'fulfilled') {
                updatedPoints.push(result.value);
            }
        });
        
        // Минимальная задержка между пакетами
        if (i + BATCH_SIZE < points.length && points.length > 200) {
            await sleep(100);
        }
    }
    
    console.log('Быстрая обработка завершена:', updatedPoints.length, 'точек');
    return updatedPoints;
}

// ========== ФОНГЕОКОДИРОВАНИЕ ==========
async function backgroundGeocoding() {
    // Находим точки, которым нужно геокодирование
    const pointsToGeocode = allPoints.filter(p => p.needsGeocoding && p.address);
    
    if (pointsToGeocode.length === 0) {
        console.log('Нет точек для фонового геокодирования');
        return;
    }
    
    console.log('Фоновое геокодирование для', pointsToGeocode.length, 'точек...');
    updateStatus(`Фоновое геокодирование: 0/${pointsToGeocode.length}`);
    
    // Ограничиваем количество для фоновой обработки
    const limitedPoints = pointsToGeocode.slice(0, 200);
    
    let improvedCount = 0;
    
    for (let i = 0; i < limitedPoints.length; i++) {
        const point = limitedPoints[i];
        
        try {
            const coords = await geocodeAddress(point.address, point.region);
            if (coords) {
                // Обновляем точку
                point.lat = coords.lat;
                point.lng = coords.lng;
                point.coordinates = `${coords.lat},${coords.lng}`;
                point.isMock = false;
                point.needsGeocoding = false;
                improvedCount++;
                
                // Обновляем маркер на карте
                updateMarkerOnMap(point);
                
                // Кэшируем
                const cacheKey = `geocode_${point.address}_${point.region}`.replace(/[^a-z0-9]/gi, '_');
                localStorage.setItem(cacheKey, JSON.stringify({
                    result: coords,
                    timestamp: Date.now()
                }));
            }
            
            // Задержка для API лимитов (больше для фонового режима)
            await sleep(2000);
            
        } catch (error) {
            console.warn('Фоновое геокодирование не удалось для:', point.name);
        }
        
        // Каждые 10 точек обновляем UI
        if (i % 10 === 0) {
            updateStatus(`Фоновое геокодирование: ${i}/${limitedPoints.length} (${improvedCount} улучшено)`);
        }
    }
    
    updateStatus(`Готово. ${improvedCount} точек улучшено`);
    if (improvedCount > 0) {
        showNotification(`Фоновое геокодирование: улучшено ${improvedCount} точек`, 'success');
    }
}

// ========== БЫСТРАЯ БАЗА КООРДИНАТ ==========
function getQuickCoordinates(address, region = '') {
    // Нормализуем текст
    const searchText = (address + ' ' + region).toLowerCase();
    
    // База координат городов (основные города РФ)
    const cityCoordinates = {
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
        'саратов': { lat: 51.5924, lng: 45.9608 },
        'краснодар': { lat: 45.0355, lng: 38.9753 },
        'тюмень': { lat: 57.1530, lng: 65.5343 },
        'тольятти': { lat: 53.5078, lng: 49.4204 },
        'ижевск': { lat: 56.8527, lng: 53.2115 },
        'барнаул': { lat: 53.3548, lng: 83.7698 },
        'ульяновск': { lat: 54.3142, lng: 48.4031 },
        'иркутск': { lat: 52.2896, lng: 104.2806 },
        'хабаровск': { lat: 48.4802, lng: 135.0719 },
        'ярославль': { lat: 57.6261, lng: 39.8845 },
        'владивосток': { lat: 43.1155, lng: 131.8855 },
        'махачкала': { lat: 42.9831, lng: 47.5047 },
        'томск': { lat: 56.4846, lng: 84.9476 },
        'оренбург': { lat: 51.7682, lng: 55.0974 },
        'кемерово': { lat: 55.3547, lng: 86.0873 },
        'новокузнецк': { lat: 53.7576, lng: 87.1360 },
        'рязань': { lat: 54.6294, lng: 39.7417 },
        'астрахань': { lat: 46.3497, lng: 48.0408 },
        'пенза': { lat: 53.2001, lng: 45.0047 },
        'липецк': { lat: 52.6088, lng: 39.5992 },
        'киров': { lat: 58.6035, lng: 49.6680 },
        'чебоксары': { lat: 56.1463, lng: 47.2511 },
        'калининград': { lat: 54.7104, lng: 20.4522 },
        'тула': { lat: 54.1930, lng: 37.6173 },
        'ставрополь': { lat: 45.0433, lng: 41.9691 },
        'курск': { lat: 51.7304, lng: 36.1926 },
        'сочи': { lat: 43.5855, lng: 39.7231 },
        'тверь': { lat: 56.8587, lng: 35.9176 },
        'магнитогорск': { lat: 53.4072, lng: 58.9798 },
        'иваново': { lat: 57.0004, lng: 40.9739 },
        'брянск': { lat: 53.2436, lng: 34.3642 },
        'белгород': { lat: 50.5953, lng: 36.5873 },
        'сургут': { lat: 61.2541, lng: 73.3962 },
        'владимир': { lat: 56.1290, lng: 40.4066 },
        'архангельск': { lat: 64.5401, lng: 40.5433 },
        'калуга': { lat: 54.5140, lng: 36.2616 },
        'крым': { lat: 45.0433, lng: 34.6021 },
        'симферополь': { lat: 44.9521, lng: 34.1024 },
        'севастополь': { lat: 44.6166, lng: 33.5254 }
    };
    
    // Ищем совпадения с городами
    for (const [city, coords] of Object.entries(cityCoordinates)) {
        if (searchText.includes(city)) {
            // Добавляем небольшое случайное смещение в пределах города
            return {
                lat: coords.lat + (Math.random() - 0.5) * 0.03,
                lng: coords.lng + (Math.random() - 0.5) * 0.06
            };
        }
    }
    
    return null;
}

async function geocodeAddress(address, region = '') {
    // Нормализуем адрес
    let query = address.trim();
    
    // Удаляем лишние пробелы и дублирование
    query = query.replace(/\s+/g, ' ');
    
    // Если есть регион - добавляем
    if (region && region.trim()) {
        query += `, ${region.trim()}`;
    }
    
    // Добавляем страну
    query += ', Россия';
    
    const cacheKey = `geocode_${query}`.replace(/[^a-z0-9]/gi, '_');
    
    // Проверяем расширенный кэш
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            // Кэш на 90 дней для часто используемых адресов
            if (Date.now() - data.timestamp < 90 * 24 * 60 * 60 * 1000) {
                return data.result;
            }
        } catch (e) {
            // Ошибка парсинга - очищаем
            localStorage.removeItem(cacheKey);
        }
    }
    
    // Для теста используем локальную базу координат по городам
    const quickCoordinates = getQuickCoordinates(address, region);
    if (quickCoordinates) {
        // Кэшируем быстрый результат
        localStorage.setItem(cacheKey, JSON.stringify({
            result: quickCoordinates,
            timestamp: Date.now()
        }));
        return quickCoordinates;
    }
    
    // Если нет в быстрой базе, пробуем Nominatim
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'TTMapApp/1.0 (contact@example.com)',
                'Accept-Language': 'ru',
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            const result = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
            
            // Кэшируем
            localStorage.setItem(cacheKey, JSON.stringify({
                result: result,
                timestamp: Date.now()
            }));
            
            return result;
        }
    } catch (error) {
        console.warn('Геокодирование не удалось:', error.message);
    }
    
    return null;
}

function getRandomCoordinate(type, region) {
    // Координаты по регионам (расширенный список)
    const regionCoords = {
        'москва': { lat: 55.7558, lng: 37.6173 },
        'московская': { lat: 55.7539, lng: 37.6208 },
        'ленинградская': { lat: 59.9391, lng: 30.3159 },
        'санкт-петербург': { lat: 59.9343, lng: 30.3351 },
        'свердловская': { lat: 56.8389, lng: 60.6057 },
        'краснодарский': { lat: 45.0355, lng: 38.9753 },
        'татарстан': { lat: 55.7961, lng: 49.1064 },
        'башкортостан': { lat: 54.7351, lng: 55.9587 },
        'нижегородская': { lat: 56.3269, lng: 44.0065 },
        'челябинская': { lat: 55.1644, lng: 61.4368 },
        'самарская': { lat: 53.2415, lng: 50.2212 },
        'ростовская': { lat: 47.2357, lng: 39.7015 },
        'красноярский': { lat: 56.0090, lng: 92.8726 },
        'пермский': { lat: 58.0105, lng: 56.2294 },
        'алтайский': { lat: 53.3481, lng: 83.7794 },
        'волгоградская': { lat: 48.7071, lng: 44.5170 },
        'воронежская': { lat: 51.6606, lng: 39.2006 },
        'омская': { lat: 54.9893, lng: 73.3682 },
        'саратовская': { lat: 51.5924, lng: 45.9608 },
        'тверская': { lat: 56.8587, lng: 35.9176 },
        'тверь': { lat: 56.8587, lng: 35.9176 },
        'архангельская': { lat: 64.5401, lng: 40.5433 },
        'астраханская': { lat: 46.3497, lng: 48.0408 },
        'ивановская': { lat: 57.0004, lng: 40.9739 },
        'калужская': { lat: 54.5140, lng: 36.2616 },
        'курская': { lat: 51.7304, lng: 36.1926 },
        'липецкая': { lat: 52.6088, lng: 39.5992 },
        'новосибирская': { lat: 55.0084, lng: 82.9357 },
        'оренбургская': { lat: 51.7682, lng: 55.0974 },
        'пензенская': { lat: 53.2001, lng: 45.0047 },
        'рязанская': { lat: 54.6294, lng: 39.7417 },
        'тамбовская': { lat: 52.7212, lng: 41.4523 },
        'тульская': { lat: 54.1930, lng: 37.6173 },
        'ульяновская': { lat: 54.3142, lng: 48.4031 },
        'ярославская': { lat: 57.6261, lng: 39.8845 },
        'крым': { lat: 45.0433, lng: 34.6021 },
        'севастополь': { lat: 44.6166, lng: 33.5254 },
        'default': { lat: 55.7558, lng: 37.6173 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    
    // Ищем регион
    if (region) {
        const regionLower = region.toLowerCase();
        for (const [key, coords] of Object.entries(regionCoords)) {
            if (regionLower.includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                break;
            }
        }
    }
    
    // Добавляем случайное смещение (до 2 градусов для регионов)
    const offset = 1.0;
    if (type === 'lat') {
        return baseLat + (Math.random() - 0.5) * offset;
    } else {
        return baseLng + (Math.random() - 0.5) * offset * 2;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
            lng: 37.6145
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
            lng: 37.4450
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
            lng: 83.7794 + (Math.random() - 0.5) * 1.0
        }
    ];
    
    updateFilters();
    updateStatistics();
    updateLegend();
    showPointsOnMap();
    
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
    
    const icon = L.divIcon({
        html: `
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
                position: relative;
            ">
                ${point.name ? point.name.charAt(0).toUpperCase() : 'Т'}
                ${point.isMock ? `
                    <div style="
                        position: absolute;
                        top: -3px;
                        right: -3px;
                        width: 10px;
                        height: 10px;
                        background: #f39c12;
                        border-radius: 50%;
                        border: 1px solid white;
                    "></div>
                ` : ''}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status
    });
    
    // Всплывающее окно
    marker.bindPopup(createPopupContent(point));
    
    // Клик по маркеру
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

// ========== ОБНОВЛЕНИЕ МАРКЕРА ==========
function updateMarkerOnMap(point) {
    // Создаем новый маркер
    const newMarker = createMarker(point);
    
    // Находим и удаляем старый маркер
    let found = false;
    markerCluster.getLayers().forEach((layer, index) => {
        if (layer.options.title === point.name && 
            Math.abs(layer.getLatLng().lat - point.lat) < 0.001 &&
            Math.abs(layer.getLatLng().lng - point.lng) < 0.001) {
            
            markerCluster.removeLayer(layer);
            markerCluster.addLayer(newMarker);
            found = true;
        }
    });
    
    // Если не нашли, просто добавляем новый
    if (!found) {
        markerCluster.addLayer(newMarker);
    }
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    return `
        <div style="min-width: 250px; max-width: 300px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Без названия'}
                ${point.isMock ? '<span style="color: #f39c12; font-size: 12px;"> (приблизительно)</span>' : ''}
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
            
            ${point.isMock ? `
                <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px;">
                    <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
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
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты<br>
                <small>Будет уточнено в фоновом режиме</small>
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========== УЛУЧШЕНИЕ КООРДИНАТ ==========
async function improveGeocoding() {
    const pointsToImprove = allPoints.filter(p => p.isMock && p.address);
    
    if (pointsToImprove.length === 0) {
        showNotification('Нет точек для уточнения координат', 'info');
        return;
    }
    
    showModal('Уточнение координат', 
        `Найдено ${pointsToImprove.length} точек для уточнения. Начнем обработку...`);
    
    // Ограничиваем количество
    const limitedPoints = pointsToImprove.slice(0, 50);
    
    let improvedCount = 0;
    
    for (let i = 0; i < limitedPoints.length; i++) {
        const point = limitedPoints[i];
        
        updateModal('Уточнение координат', 
            `Обрабатываем ${i+1} из ${limitedPoints.length}... (${improvedCount} улучшено)`);
        
        try {
            const coords = await geocodeAddress(point.address, point.region);
            if (coords) {
                // Обновляем точку
                point.lat = coords.lat;
                point.lng = coords.lng;
                point.coordinates = `${coords.lat},${coords.lng}`;
                point.isMock = false;
                improvedCount++;
                
                // Обновляем маркер
                updateMarkerOnMap(point);
                
                // Кэшируем
                const cacheKey = `geocode_${point.address}_${point.region}`.replace(/[^a-z0-9]/gi, '_');
                localStorage.setItem(cacheKey, JSON.stringify({
                    result: coords,
                    timestamp: Date.now()
                }));
            }
            
            // Уважаем лимиты API - задержка 1.5 секунды
            await sleep(1500);
            
        } catch (error) {
            console.warn('Не удалось уточнить:', point.name);
        }
    }
    
    closeModal();
    updateStatistics();
    showNotification(`Уточнены координаты для ${improvedCount} точек`, 'success');
}

// ========== СТАТИСТИКА И ЛЕГЕНДА ==========
function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const mockPoints = filteredPoints.filter(p => p.isMock).length;
    
    document.getElementById('total-points').textContent = allPoints.length;
    document.getElementById('shown-points').textContent = shownPoints;
    
    // Добавляем информацию о приблизительных точках в статус
    if (mockPoints > 0) {
        const statusEl = document.getElementById('status');
        if (statusEl && !statusEl.innerHTML.includes('приблизительно')) {
            statusEl.innerHTML += ` (${mockPoints} приблизительно)`;
        }
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
    
    // Добавляем маркер для приблизительных координат
    legendHTML += `
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee;">
            <div style="position: relative; width: 15px; height: 15px;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #95a5a6; border: 2px solid white;"></div>
                <div style="position: absolute; top: -2px; right: -2px; width: 6px; height: 6px; background: #f39c12; border-radius: 50%; border: 1px solid white;"></div>
            </div>
            <span style="font-size: 11px; color: #666;">Приблизительные координаты</span>
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
            max-width: 400px;
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

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.improveGeocoding = improveGeocoding;
