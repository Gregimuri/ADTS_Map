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
let isGeocoding = false;
let geocodingQueue = [];
let geocodingProgress = { processed: 0, total: 0 };

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

// ========== УМНОЕ ГЕОКОДИРОВАНИЕ (Яндекс → OSM) ==========
class SmartGeocoder {
    constructor() {
        this.cache = this.loadCache();
        this.geocodingInProgress = false;
        this.stats = {
            yandex: 0,
            osm: 0,
            cache: 0,
            failed: 0,
            total: 0
        };
    }

    loadCache() {
        try {
            const cached = localStorage.getItem('geocoder_cache');
            if (cached) {
                const data = JSON.parse(cached);
                // Проверяем срок действия кэша (30 дней)
                if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
                    return data.cache;
                }
            }
        } catch (e) {
            console.warn('Ошибка загрузки кэша:', e);
        }
        return {};
    }

    saveCache() {
        try {
            localStorage.setItem('geocoder_cache', JSON.stringify({
                timestamp: Date.now(),
                cache: this.cache
            }));
        } catch (e) {
            console.warn('Ошибка сохранения кэша:', e);
        }
    }

    normalizeAddress(address) {
        if (!address) return '';
        
        let normalized = address
            .replace(/\([^)]*\)/g, '') // Удаляем текст в скобках
            .replace(/\d{6},?\s*/g, '') // Удаляем почтовый индекс
            .replace(/\b(нас\.?пункт|торг\.?точка|тт|магазин|здание|помещение)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Стандартизируем сокращения
        const replacements = {
            'ул\.': 'ул',
            'улица': 'ул',
            'пр\.': 'пр-кт',
            'проспект': 'пр-кт',
            'д\.': 'д',
            'дом': 'д',
            'г\.': 'г',
            'город': 'г',
            'обл\.': 'обл',
            'область': 'обл',
            'респ\.': 'респ',
            'республика': 'респ'
        };
        
        for (const [from, to] of Object.entries(replacements)) {
            normalized = normalized.replace(new RegExp(from, 'gi'), to);
        }
        
        return normalized;
    }

    async geocodeYandex(address) {
        try {
            const cleanAddress = this.normalizeAddress(address);
            const encoded = encodeURIComponent(cleanAddress);
            const url = `https://yandex.ru/maps/?text=${encoded}`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'ru-RU,ru;q=0.9'
                }
            });
            
            const text = await response.text();
            
            // Ищем координаты в ответе Яндекс
            const patterns = [
                /data-coordinates="([^"]+)"/,
                /"coordinates":\s*\[([\d.,\s]+)\]/,
                /ll=([\d.]+),([\d.]+)/
            ];
            
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) {
                    let lat, lon;
                    
                    if (match[1] && match[2]) {
                        lat = parseFloat(match[2]);
                        lon = parseFloat(match[1]);
                    } else if (match[1]) {
                        const coords = match[1].split(',');
                        if (coords.length >= 2) {
                            lat = parseFloat(coords[1]);
                            lon = parseFloat(coords[0]);
                        }
                    }
                    
                    if (lat && lon) {
                        this.stats.yandex++;
                        return { lat, lon, source: 'yandex' };
                    }
                }
            }
        } catch (error) {
            console.warn('Ошибка геокодирования Яндекс:', error);
        }
        
        return null;
    }

    async geocodeOSM(address) {
        try {
            const cleanAddress = this.normalizeAddress(address);
            let query = cleanAddress;
            
            // Добавляем "Россия" если нет
            if (!query.toLowerCase().includes('россия')) {
                query += ', Россия';
            }
            
            const encoded = encodeURIComponent(query);
            const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=ru&accept-language=ru`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'TTMapApp/1.0',
                    'Accept-Language': 'ru'
                }
            });
            
            const data = await response.json();
            
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);
                this.stats.osm++;
                return { lat, lon, source: 'osm' };
            }
        } catch (error) {
            console.warn('Ошибка геокодирования OSM:', error);
        }
        
        return null;
    }

    async geocode(address, skipCache = false) {
        if (!address || address.length < 5) return null;
        
        this.stats.total++;
        
        // Проверяем кэш
        const cacheKey = address.toLowerCase().trim();
        if (!skipCache && this.cache[cacheKey]) {
            this.stats.cache++;
            return this.cache[cacheKey];
        }
        
        // 1. Пробуем Яндекс
        let result = await this.geocodeYandex(address);
        
        // 2. Если Яндекс не нашел, пробуем OSM
        if (!result) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка для OSM
            result = await this.geocodeOSM(address);
        }
        
        // 3. Если оба источника не нашли
        if (!result) {
            this.stats.failed++;
            console.warn('Не удалось геокодировать адрес:', address);
            return null;
        }
        
        // Сохраняем в кэш
        this.cache[cacheKey] = result;
        this.saveCache();
        
        return result;
    }

    async batchGeocode(addresses, progressCallback = null) {
        const results = [];
        const total = addresses.length;
        
        this.geocodingInProgress = true;
        
        for (let i = 0; i < addresses.length; i++) {
            const address = addresses[i];
            
            try {
                const result = await this.geocode(address);
                results.push(result);
                
                if (progressCallback) {
                    progressCallback(i + 1, total, address, result);
                }
                
                // Задержка между запросами
                if (i < addresses.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } catch (error) {
                console.error('Ошибка при геокодировании адреса:', address, error);
                results.push(null);
            }
        }
        
        this.geocodingInProgress = false;
        
        console.log('📊 Статистика геокодирования:');
        console.log(`  Всего: ${this.stats.total}`);
        console.log(`  Кэш: ${this.stats.cache}`);
        console.log(`  Яндекс: ${this.stats.yandex}`);
        console.log(`  OSM: ${this.stats.osm}`);
        console.log(`  Не найдено: ${this.stats.failed}`);
        
        return results;
    }
}

// Создаем глобальный экземпляр геокодера
const smartGeocoder = new SmartGeocoder();

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
        
        // 3. Фоновое геокодирование точек без координат
        await geocodeMissingPoints(allPoints);
        
        // 4. Обновляем интерфейс
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        // 5. Скрываем модальное окно
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
        
        showNotification('Данные успешно загружены', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        setTimeout(tryAlternativeLoad, 5000);
    }
}

// ========== ФОНОВОЕ ГЕОКОДИРОВАНИЕ ==========
async function geocodeMissingPoints(points) {
    const pointsWithoutCoords = points.filter(p => 
        !p.lat || !p.lng || p.isMock
    );
    
    if (pointsWithoutCoords.length === 0) {
        console.log('Все точки уже имеют координаты');
        return points;
    }
    
    console.log(`Найдено ${pointsWithoutCoords.length} точек без координат`);
    
    // Показываем прогресс
    showModal('Геокодирование', 
        `Найдено ${pointsWithoutCoords.length} точек без координат.<br>
         Начинаю фоновое геокодирование...`);
    
    // Собираем адреса для геокодирования
    const addresses = pointsWithoutCoords.map(p => {
        if (p.address && p.region) {
            return `${p.address}, ${p.region}, Россия`;
        } else if (p.address) {
            return `${p.address}, Россия`;
        } else if (p.region) {
            return p.region;
        }
        return '';
    }).filter(addr => addr.length > 5);
    
    if (addresses.length === 0) {
        console.log('Нет адресов для геокодирования');
        return points;
    }
    
    // Запускаем фоновое геокодирование
    startBackgroundGeocoding(addresses, pointsWithoutCoords);
    
    return points;
}

function startBackgroundGeocoding(addresses, points) {
    if (isGeocoding) {
        console.log('Геокодирование уже выполняется');
        return;
    }
    
    isGeocoding = true;
    geocodingQueue = addresses;
    geocodingProgress = { processed: 0, total: addresses.length };
    
    // Показываем уведомление
    showNotification(`Начинаю фоновое геокодирование ${addresses.length} адресов`, 'info');
    
    // Запускаем в фоне
    processGeocodingQueue(points);
}

async function processGeocodingQueue(points) {
    const batchSize = 5;
    
    while (geocodingQueue.length > 0 && isGeocoding) {
        const batch = geocodingQueue.splice(0, Math.min(batchSize, geocodingQueue.length));
        
        for (const address of batch) {
            try {
                // Находим соответствующую точку
                const pointIndex = points.findIndex(p => 
                    (p.address && address.includes(p.address)) || 
                    (p.region && address.includes(p.region))
                );
                
                if (pointIndex === -1) continue;
                
                const point = points[pointIndex];
                
                // Геокодируем адрес
                const result = await smartGeocoder.geocode(address);
                
                if (result) {
                    // Обновляем точку
                    point.lat = result.lat;
                    point.lng = result.lng;
                    point.coordinates = `${result.lat},${result.lng}`;
                    point.isMock = false;
                    point.geocodeSource = result.source;
                    
                    // Обновляем на карте
                    updatePointOnMap(point);
                }
                
                geocodingProgress.processed++;
                
                // Обновляем статус каждые 10 точек
                if (geocodingProgress.processed % 10 === 0) {
                    updateStatus(`Геокодирование: ${geocodingProgress.processed}/${geocodingProgress.total}`);
                    
                    // Показываем уведомление о прогрессе
                    if (geocodingProgress.processed % 50 === 0) {
                        const remaining = geocodingProgress.total - geocodingProgress.processed;
                        showNotification(
                            `Геокодирование: ${geocodingProgress.processed} из ${geocodingProgress.total} (осталось: ${remaining})`,
                            'info'
                        );
                    }
                }
                
            } catch (error) {
                console.warn('Ошибка при геокодировании:', error);
            }
            
            // Задержка между запросами
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Сохраняем прогресс в localStorage
        saveGeocodingProgress();
    }
    
    if (geocodingQueue.length === 0) {
        isGeocoding = false;
        
        // Показываем завершающее уведомление
        showNotification('Фоновое геокодирование завершено!', 'success');
        updateStatus(`Готово: ${allPoints.length} точек`);
        
        // Обновляем карту
        showPointsOnMap();
        updateStatistics();
    }
}

function saveGeocodingProgress() {
    try {
        localStorage.setItem('geocoding_progress', JSON.stringify({
            processed: geocodingProgress.processed,
            total: geocodingProgress.total,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.warn('Ошибка сохранения прогресса:', e);
    }
}

function loadGeocodingProgress() {
    try {
        const saved = localStorage.getItem('geocoding_progress');
        if (saved) {
            const data = JSON.parse(saved);
            // Если прошло меньше часа, восстанавливаем прогресс
            if (Date.now() - data.timestamp < 60 * 60 * 1000) {
                return data;
            }
        }
    } catch (e) {
        console.warn('Ошибка загрузки прогресса:', e);
    }
    return null;
}

function updatePointOnMap(point) {
    // Находим и обновляем маркер на карте
    markerCluster.eachLayer((layer) => {
        if (layer.options.title === point.name) {
            const newMarker = createMarker(point);
            markerCluster.removeLayer(layer);
            markerCluster.addLayer(newMarker);
            return;
        }
    });
}

// ========== АЛЬТЕРНАТИВНЫЙ СПОСОБ ЗАГРУЗКИ ==========
async function tryAlternativeLoad() {
    try {
        updateStatus('Пробуем альтернативный способ...');
        
        const csvUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv`;
        
        const response = await fetch(csvUrl);
        const csvText = await response.text();
        
        const rows = csvText.split('\n').filter(row => row.trim() !== '');
        
        if (rows.length < 2) {
            throw new Error('Мало данных в CSV');
        }
        
        const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));
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
        
    } catch (error) {
        console.error('Ошибка альтернативной загрузки:', error);
        showNotification('Не удалось загрузить данные. Проверьте доступ к таблице.', 'error');
        
        showDemoData();
    }
}

// ========== ЗАГРУЗКА ДАННЫХ КАК CSV ==========
async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&id=${CONFIG.SPREADSHEET_ID}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        
        const rows = csvText.split('\n').map(row => {
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
    const colIndices = findColumnIndices(headers);
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0 || row.every(cell => !cell || cell.toString().trim() === '')) {
            continue;
        }
        
        const point = {
            id: `point_${Date.now()}_${i}`,
            sheetRow: i + 1
        };
        
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && row[index]) {
                point[key] = row[index].toString().trim();
            }
        });
        
        if (!point.name) {
            for (const [key, value] of Object.entries(point)) {
                if (value && key !== 'id' && key !== 'sheetRow') {
                    point.name = value.substring(0, 30) + '...';
                    break;
                }
            }
        }
        
        // Проверяем, есть ли уже координаты
        if (point.address && point.coordinates) {
            const coords = point.coordinates.split(',').map(c => parseFloat(c.trim()));
            if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                point.lat = coords[0];
                point.lng = coords[1];
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
        contractor: -1,
        coordinates: -1
    };
    
    headers.forEach((header, index) => {
        if (!header) return;
        
        const headerLower = header.toString().toLowerCase().trim();
        
        if (indices.name === -1) {
            for (const name of CONFIG.COLUMN_NAMES.name) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.name = index;
                    break;
                }
            }
        }
        
        if (indices.region === -1) {
            for (const name of CONFIG.COLUMN_NAMES.region) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.region = index;
                    break;
                }
            }
        }
        
        if (indices.address === -1) {
            for (const name of CONFIG.COLUMN_NAMES.address) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.address = index;
                    break;
                }
            }
        }
        
        if (indices.status === -1) {
            for (const name of CONFIG.COLUMN_NAMES.status) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.status = index;
                    break;
                }
            }
        }
        
        if (indices.manager === -1) {
            for (const name of CONFIG.COLUMN_NAMES.manager) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.manager = index;
                    break;
                }
            }
        }
        
        if (indices.contractor === -1) {
            for (const name of CONFIG.COLUMN_NAMES.contractor) {
                if (headerLower.includes(name.toLowerCase())) {
                    indices.contractor = index;
                    break;
                }
            }
        }
        
        if (indices.coordinates === -1) {
            const coordPatterns = ['координат', 'coordinates', 'lat', 'lon', 'широта', 'долгота'];
            for (const pattern of coordPatterns) {
                if (headerLower.includes(pattern)) {
                    indices.coordinates = index;
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
        const processedPoint = {
            id: `point_${Date.now()}_${Math.random()}`,
            name: point['Название ТТ'] || point['Магазин'] || 'Без названия',
            region: point['Регион'] || point['Область'] || '',
            address: point['Адрес'] || point['Местоположение'] || '',
            status: point['Статус ТТ'] || point['Статус'] || '',
            manager: point['Менеджер ФИО'] || point['Менеджер'] || '',
            contractor: point['Подрядчик ФИО'] || point['Подрядчик'] || ''
        };
        
        if (processedPoint.address) {
            const coords = await smartGeocoder.geocode(
                `${processedPoint.address}, ${processedPoint.region || ''}`
            );
            if (coords) {
                processedPoint.lat = coords.lat;
                processedPoint.lng = coords.lng;
                processedPoint.coordinates = `${coords.lat},${coords.lng}`;
                processedPoint.geocodeSource = coords.source;
            } else {
                processedPoint.lat = getRandomCoordinate('lat', processedPoint.region);
                processedPoint.lng = getRandomCoordinate('lng', processedPoint.region);
                processedPoint.coordinates = `${processedPoint.lat},${processedPoint.lng}`;
                processedPoint.isMock = true;
            }
        } else {
            processedPoint.lat = getRandomCoordinate('lat', processedPoint.region);
            processedPoint.lng = getRandomCoordinate('lng', processedPoint.region);
            processedPoint.coordinates = `${processedPoint.lat},${processedPoint.lng}`;
            processedPoint.isMock = true;
        }
        
        processedPoints.push(processedPoint);
    }
    
    return processedPoints;
}

// ========== ГЕОКОДИРОВАНИЕ ==========
async function addCoordinates(points) {
    console.log('Добавление координат для', points.length, 'точек...');
    
    const updatedPoints = [];
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        if (i % 10 === 0) {
            updateModal('Геокодирование', `Обработано ${i} из ${points.length} адресов...`);
        }
        
        if (point.address && !point.lat) {
            try {
                const address = point.region ? 
                    `${point.address}, ${point.region}, Россия` : 
                    `${point.address}, Россия`;
                
                const coords = await smartGeocoder.geocode(address);
                
                if (coords) {
                    point.lat = coords.lat;
                    point.lng = coords.lng;
                    point.coordinates = `${coords.lat},${coords.lng}`;
                    point.geocodeSource = coords.source;
                } else {
                    point.lat = getRandomCoordinate('lat', point.region);
                    point.lng = getRandomCoordinate('lng', point.region);
                    point.coordinates = `${point.lat},${point.lng}`;
                    point.isMock = true;
                }
                
                await sleep(500);
                
            } catch (error) {
                console.warn('Ошибка геокодирования:', error);
                point.lat = getRandomCoordinate('lat', point.region);
                point.lng = getRandomCoordinate('lng', point.region);
                point.coordinates = `${point.lat},${point.lng}`;
                point.isMock = true;
            }
        } else if (!point.lat) {
            point.lat = getRandomCoordinate('lat', point.region);
            point.lng = getRandomCoordinate('lng', point.region);
            point.coordinates = `${point.lat},${point.lng}`;
            point.isMock = true;
        }
        
        updatedPoints.push(point);
    }
    
    return updatedPoints;
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
            status: 'сдан',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.7570,
            lng: 37.6145,
            geocodeSource: 'yandex'
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
            geocodeSource: 'osm'
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
            isMock: true
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
    markerCluster.clearLayers();
    
    const filteredPoints = filterPoints();
    
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
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
}

function createMarker(point) {
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
    
    // Добавляем иконку источника геокодирования
    let sourceIcon = '';
    if (point.geocodeSource === 'yandex') {
        sourceIcon = '<div style="position: absolute; top: -5px; right: -5px; width: 12px; height: 12px; background: #ffcc00; border-radius: 50%; border: 2px solid white;"></div>';
    } else if (point.geocodeSource === 'osm') {
        sourceIcon = '<div style="position: absolute; top: -5px; right: -5px; width: 12px; height: 12px; background: #7bc96f; border-radius: 50%; border: 2px solid white;"></div>';
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
                ${sourceIcon}
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
    
    marker.bindPopup(createPopupContent(point));
    
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    let sourceInfo = '';
    if (point.geocodeSource === 'yandex') {
        sourceInfo = '<div style="color: #ffcc00; font-size: 11px; margin-top: 5px;"><i class="fas fa-map-marked-alt"></i> Яндекс.Карты</div>';
    } else if (point.geocodeSource === 'osm') {
        sourceInfo = '<div style="color: #7bc96f; font-size: 11px; margin-top: 5px;"><i class="fas fa-globe"></i> OpenStreetMap</div>';
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
            
            ${point.lat && point.lng ? `
                <div style="margin-top: 10px; font-size: 11px; color: #666;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </div>
            ` : ''}
            
            ${sourceInfo}
            
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
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    showPointsOnMap();
    
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
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
    return allPoints.filter(point => {
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
    
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    }
    
    let sourceInfo = '';
    if (point.geocodeSource === 'yandex') {
        sourceInfo = '<div style="color: #ffcc00; margin-top: 10px; font-size: 12px;"><i class="fas fa-map-marked-alt"></i> Найдено через Яндекс.Карты</div>';
    } else if (point.geocodeSource === 'osm') {
        sourceInfo = '<div style="color: #7bc96f; margin-top: 10px; font-size: 12px;"><i class="fas fa-globe"></i> Найдено через OpenStreetMap</div>';
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
            
            ${sourceInfo}
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
    
    // Подсчитываем статистику геокодирования
    const geocodedPoints = allPoints.filter(p => p.geocodeSource).length;
    const yandexPoints = allPoints.filter(p => p.geocodeSource === 'yandex').length;
    const osmPoints = allPoints.filter(p => p.geocodeSource === 'osm').length;
    
    document.getElementById('total-points').textContent = allPoints.length;
    document.getElementById('shown-points').textContent = shownPoints;
    
    // Добавляем статистику в статус
    if (geocodedPoints > 0) {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.innerHTML += ` | 🗺️ ${geocodedPoints} точек геокодировано`;
        }
    }
}

function updateLegend() {
    const container = document.getElementById('legend');
    
    let legendHTML = '';
    
    const statuses = new Set();
    allPoints.forEach(point => {
        if (point.status) {
            statuses.add(point.status);
        }
    });
    
    if (statuses.size < 3) {
        statuses.add('сдан');
        statuses.add('Отправлен ФО, не принят');
        statuses.add('План');
    }
    
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
    
    // Добавляем легенду источников геокодирования
    legendHTML += `
        <div style="border-top: 1px solid #ddd; margin-top: 10px; padding-top: 10px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background: #ffcc00; border: 2px solid white;"></div>
                <span style="font-size: 11px;">Яндекс.Карты</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background: #7bc96f; border: 2px solid white;"></div>
                <span style="font-size: 11px;">OpenStreetMap</span>
            </div>
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

// ========== УТИЛИТЫ ==========
function getRandomCoordinate(type, region) {
    const regionCoords = {
        'Алтайский': { lat: 53.3481, lng: 83.7794 },
        'Архангельская': { lat: 64.5401, lng: 40.5433 },
        'Астраханская': { lat: 46.3497, lng: 48.0408 },
        'Москва': { lat: 55.7558, lng: 37.6173 },
        'Московская': { lat: 55.7539, lng: 37.6208 },
        'Санкт-Петербург': { lat: 59.9343, lng: 30.3351 },
        'default': { lat: 55.7558, lng: 37.6173 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    
    if (region) {
        for (const [key, coords] of Object.entries(regionCoords)) {
            if (region.toLowerCase().includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                break;
            }
        }
    }
    
    const offset = 0.5;
    if (type === 'lat') {
        return baseLat + (Math.random() - 0.5) * offset;
    } else {
        return baseLng + (Math.random() - 0.5) * offset * 2;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    document.getElementById('modal-message').innerHTML = message;
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
    }, 5000);
}

// ========== НОВЫЕ ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ ГЕОКОДИРОВАНИЕМ ==========
function startManualGeocoding() {
    const pointsWithoutCoords = allPoints.filter(p => !p.lat || !p.lng || p.isMock);
    
    if (pointsWithoutCoords.length === 0) {
        showNotification('Все точки уже имеют координаты', 'info');
        return;
    }
    
    const confirm = window.confirm(
        `Найдено ${pointsWithoutCoords.length} точек без координат.\n` +
        `Начать фоновое геокодирование?`
    );
    
    if (confirm) {
        startBackgroundGeocoding(
            pointsWithoutCoords.map(p => p.address || p.region).filter(addr => addr),
            pointsWithoutCoords
        );
    }
}

function stopGeocoding() {
    if (isGeocoding) {
        isGeocoding = false;
        showNotification('Геокодирование остановлено', 'warning');
        updateStatus('Готово');
    }
}

function showGeocodingStats() {
    const geocoded = allPoints.filter(p => p.geocodeSource).length;
    const yandex = allPoints.filter(p => p.geocodeSource === 'yandex').length;
    const osm = allPoints.filter(p => p.geocodeSource === 'osm').length;
    const mock = allPoints.filter(p => p.isMock).length;
    
    showModal(
        'Статистика геокодирования',
        `📊 Всего точек: ${allPoints.length}<br>
         🗺️ Геокодировано: ${geocoded}<br>
         📍 Яндекс.Карты: ${yandex}<br>
         🌍 OpenStreetMap: ${osm}<br>
         ⚠️ Приблизительные: ${mock}<br><br>
         <small>Кэш геокодера: ${Object.keys(smartGeocoder.cache).length} адресов</small>`
    );
}

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.startManualGeocoding = startManualGeocoding;
window.stopGeocoding = stopGeocoding;
window.showGeocodingStats = showGeocodingStats;
