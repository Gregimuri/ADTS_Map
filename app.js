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
let autonomousGeocoder;
let isInitialLoad = true;
let pointsQueue = [];
let processedPointsCount = 0;
let displayedPointsCount = 0;
let isGeocodingActive = false;

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    initAutonomousGeocoder();
    loadData();
    setupAutoUpdate();
});

// ========== ИНИЦИАЛИЗАЦИЯ АВТОНОМНОГО ГЕОКОДЕРА ==========
function initAutonomousGeocoder() {
    autonomousGeocoder = new AutonomousGeocoder();
    console.log('🚀 Автономный геокодер инициализирован');
    updateStatus('<i class="fas fa-check-circle" style="color: #2ecc71;"></i> Геокодер готов');
}

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

// ========== ЗАГРУЗКА ДАННЫХ С ПОЭТАПНЫМ ОТОБРАЖЕНИЕМ ==========
async function loadData() {
    try {
        updateStatus('<i class="fas fa-sync-alt fa-spin"></i> Загрузка данных...');
        showLoadingStats(true);
        
        // 1. Загружаем данные
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        // 2. Обрабатываем структуру данных
        const rawPoints = processData(data);
        console.log(`📊 Загружено ${rawPoints.length} точек`);
        
        // 3. Сразу показываем все точки с временными координатами
        showPointsImmediately(rawPoints);
        
        // 4. Запускаем фоновое геокодирование с постепенным обновлением
        startProgressiveGeocoding(rawPoints);
        
        showNotification('Точки загружены, ищу точные координаты...', 'info');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('<i class="fas fa-exclamation-circle" style="color: #e74c3c;"></i> Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        // Пробуем альтернативный метод
        setTimeout(tryAlternativeLoad, 5000);
    }
}

// ========== ПОСТЕПЕННОЕ ГЕОКОДИРОВАНИЕ ==========
async function startProgressiveGeocoding(points) {
    if (isGeocodingActive) {
        console.log('Геокодирование уже запущено');
        return;
    }
    
    isGeocodingActive = true;
    console.log(`🔄 Начинаю постепенное геокодирование для ${points.length} точек`);
    
    allPoints = points;
    processedPointsCount = 0;
    displayedPointsCount = 0;
    
    // Создаем копию для обработки
    pointsQueue = [...points];
    
    // Запускаем обработку порциями
    processGeocodingBatch();
}

// ========== ОБРАБОТКА ПАКЕТА ТОЧЕК ==========
async function processGeocodingBatch() {
    if (pointsQueue.length === 0) {
        // Все точки обработаны
        isGeocodingActive = false;
        updateStatus(`<i class="fas fa-check-circle" style="color: #2ecc71;"></i> Готово! ${processedPointsCount} точек`);
        showNotification(`Все координаты найдены (${processedPointsCount} точек)`, 'success');
        
        // Обновляем фильтры и легенду
        updateFilters();
        updateLegend();
        showLoadingStats(false);
        
        return;
    }
    
    const BATCH_SIZE = 3;
    const batch = pointsQueue.splice(0, BATCH_SIZE);
    
    // Обрабатываем пакет параллельно
    const batchPromises = batch.map(async (point, index) => {
        try {
            // Геокодируем через автономный геокодер
            const result = await autonomousGeocoder.geocode(
                point.address || '', 
                point.region || '', 
                point.city || ''
            );
            
            if (result) {
                // Обновляем точку
                point.lat = result.lat;
                point.lng = result.lng;
                point.coordinates = `${result.lat},${result.lng}`;
                point.source = result.source;
                point.isMock = result.isApproximate || false;
                point.geocoded = true;
                point.processed = true;
                
                if (result.isApproximate) {
                    point.precision = 'low';
                    point.needsImprovement = true;
                } else {
                    point.precision = result.precision || 'medium';
                }
                
                // Обновляем маркер на карте
                updatePointOnMap(point);
                
                // Увеличиваем счетчик
                processedPointsCount++;
                displayedPointsCount++;
                
                console.log(`✅ Геокодировано: ${point.name}`);
                
            } else {
                // Если не нашли, отмечаем как необработанную
                point.geocoded = false;
                point.processed = true;
                point.precision = 'very low';
                processedPointsCount++;
                console.log(`❌ Не найдено: ${point.name}`);
            }
            
            return point;
        } catch (error) {
            console.warn('Ошибка геокодирования точки:', point.name, error);
            point.processed = true;
            point.geocoded = false;
            point.precision = 'error';
            processedPointsCount++;
            return point;
        }
    });
    
    // Ждем завершения пакета
    await Promise.allSettled(batchPromises);
    
    // Обновляем статистику
    updateStatistics();
    updateLoadingStatsUI();
    
    const progressPercent = Math.round((processedPointsCount / allPoints.length) * 100);
    updateStatus(`<i class="fas fa-sync-alt fa-spin"></i> Поиск координат: ${progressPercent}% (${processedPointsCount}/${allPoints.length})`);
    
    // Запускаем следующий пакет с небольшой задержкой
    setTimeout(processGeocodingBatch, 500);
}

// ========== НЕМЕДЛЕННОЕ ОТОБРАЖЕНИЕ ТОЧЕК ==========
function showPointsImmediately(points) {
    console.log(`🎯 Немедленно показываю ${points.length} точек`);
    
    // Очищаем карту
    markerCluster.clearLayers();
    displayedPointsCount = 0;
    
    // Создаем временные маркеры без координат
    points.forEach((point, index) => {
        // Создаем временную точку с координатами по региону
        const tempPoint = {
            ...point,
            lat: getRandomCoordinate('lat', point.region),
            lng: getRandomCoordinate('lng', point.region),
            isMock: true,
            isTemporary: true,
            precision: 'very low',
            source: 'Temporary placement',
            displayed: true
        };
        
        const marker = createMarker(tempPoint);
        markerCluster.addLayer(marker);
        displayedPointsCount++;
        point.tempMarker = marker;
        point.displayed = true;
        point.tempLat = tempPoint.lat;
        point.tempLng = tempPoint.lng;
    });
    
    // Центрируем карту
    centerMapOnPoints(points);
    
    // Обновляем статистику
    updateStatistics();
    updateFilters();
    updateLegend();
    updateLoadingStatsUI();
    
    console.log(`✅ Показано ${displayedPointsCount} временных точек`);
}

// ========== ОБНОВЛЕНИЕ ТОЧКИ НА КАРТЕ ==========
function updatePointOnMap(point) {
    // Удаляем временный маркер если есть
    if (point.tempMarker) {
        markerCluster.removeLayer(point.tempMarker);
        point.tempMarker = null;
    }
    
    // Добавляем новый маркер с реальными координатами
    if (point.lat && point.lng) {
        const marker = createMarker(point);
        markerCluster.addLayer(marker);
        point.displayed = true;
        
        // Если это первые 10 точек с реальными координатами, обновляем центрирование
        const realPoints = allPoints.filter(p => p.geocoded && !p.isTemporary);
        if (realPoints.length <= 10) {
            centerMapOnPoints(realPoints);
        }
    }
}

// ========== ЦЕНТРИРОВАНИЕ КАРТЫ ==========
function centerMapOnPoints(points) {
    const pointsWithCoords = points.filter(p => p.lat && p.lng);
    
    if (pointsWithCoords.length === 0) {
        return;
    }
    
    if (pointsWithCoords.length === 1) {
        // Если одна точка - центрируем на ней
        map.setView([pointsWithCoords[0].lat, pointsWithCoords[0].lng], 12);
    } else {
        // Если несколько точек - подгоняем границы
        const bounds = L.latLngBounds(
            pointsWithCoords.map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { 
                padding: [50, 50], 
                maxZoom: 12,
                animate: true 
            });
        }
    }
}

// ========== СОЗДАНИЕ МАРКЕРА ==========
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
    
    // Определяем иконку в зависимости от точности
    let markerIcon = '📌';
    let badgeColor = '';
    let opacity = 1;
    
    if (point.isTemporary) {
        markerIcon = '⏳';
        badgeColor = '#95a5a6';
        opacity = 0.7;
    } else if (point.isMock) {
        markerIcon = '📍';
        badgeColor = '#f39c12';
    } else if (point.precision === 'high') {
        markerIcon = '🎯';
        badgeColor = '#2ecc71';
    } else if (point.precision === 'medium') {
        markerIcon = '📍';
        badgeColor = '#3498db';
    } else if (point.precision === 'low') {
        markerIcon = '🌍';
        badgeColor = '#f39c12';
        opacity = 0.9;
    } else if (point.precision === 'very low') {
        markerIcon = '🌐';
        badgeColor = '#e74c3c';
        opacity = 0.8;
    }
    
    const icon = L.divIcon({
        html: `
            <div style="
                background: ${color};
                width: 35px;
                height: 35px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 16px;
                position: relative;
                opacity: ${opacity};
                ${point.isTemporary ? 'animation: pulse 2s infinite;' : ''}
            ">
                ${markerIcon}
                ${badgeColor ? `
                    <div style="
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        width: 12px;
                        height: 12px;
                        background: ${badgeColor};
                        border-radius: 50%;
                        border: 2px solid white;
                    "></div>
                ` : ''}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [35, 35],
        iconAnchor: [17, 35]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        precision: point.precision || 'unknown',
        isTemporary: point.isTemporary || false
    });
    
    // Всплывающее окно
    marker.bindPopup(createPopupContent(point));
    
    // Клик по маркеру
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

// ========== ВСПЛЫВАЮЩЕЕ ОКНО ==========
function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    // Определяем иконку точности
    let precisionIcon = '🎯';
    let precisionText = 'Высокая';
    let precisionColor = '#2ecc71';
    
    if (point.isTemporary) {
        precisionIcon = '⏳';
        precisionText = 'Идет поиск координат...';
        precisionColor = '#95a5a6';
    } else if (point.isMock) {
        precisionIcon = '📍';
        precisionText = 'Приблизительная';
        precisionColor = '#f39c12';
    } else if (point.precision === 'medium') {
        precisionIcon = '📍';
        precisionText = 'Средняя';
        precisionColor = '#3498db';
    } else if (point.precision === 'low') {
        precisionIcon = '🌍';
        precisionText = 'Низкая';
        precisionColor = '#f39c12';
    } else if (point.precision === 'very low') {
        precisionIcon = '🌐';
        precisionText = 'Очень низкая';
        precisionColor = '#e74c3c';
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
            
            <div style="margin-bottom: 10px; font-size: 12px;">
                <strong>Точность координат:</strong> 
                <span style="color: ${precisionColor}; font-weight: 500;">
                    ${precisionIcon} ${precisionText}
                </span>
                ${point.source ? `<br><small>Источник: ${point.source}</small>` : ''}
            </div>
            
            ${point.address ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address}</span>
                </div>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <div style="margin-bottom: 10px;">
                    <strong>🌍 Координаты:</strong><br>
                    <span style="font-size: 13px; font-family: monospace;">
                        ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                    </span>
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
            </div>
            
            ${point.isTemporary ? `
                <div style="margin-top: 10px; padding: 8px; background: #3498db; color: white; border-radius: 4px; font-size: 11px;">
                    <i class="fas fa-sync-alt fa-spin"></i> Идет поиск точных координат...
                </div>
            ` : point.isMock ? `
                <div style="margin-top: 10px; padding: 8px; background: #f39c12; color: white; border-radius: 4px; font-size: 11px;">
                    <i class="fas fa-map-marker-alt"></i> Приблизительные координаты
                    ${point.needsImprovement ? '<br><small>Будет уточнено в фоновом режиме</small>' : ''}
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ОБНОВЛЕННАЯ СТАТИСТИКА ==========
function updateStatistics() {
    const totalPoints = allPoints.length;
    const displayedPoints = allPoints.filter(p => p.displayed).length;
    const processedPoints = allPoints.filter(p => p.processed).length;
    const geocodedPoints = allPoints.filter(p => p.geocoded).length;
    const mockPoints = allPoints.filter(p => p.isMock && !p.isTemporary).length;
    const exactPoints = geocodedPoints - mockPoints;
    
    document.getElementById('total-points').textContent = totalPoints;
    document.getElementById('shown-points').textContent = displayedPoints;
    
    // Обновляем дополнительные счетчики если они есть
    const exactPointsEl = document.getElementById('exact-points');
    const approxPointsEl = document.getElementById('approx-points');
    
    if (exactPointsEl) exactPointsEl.textContent = exactPoints;
    if (approxPointsEl) approxPointsEl.textContent = mockPoints;
}

// ========== ОБНОВЛЕНИЕ СТАТИСТИКИ ЗАГРУЗКИ ==========
function updateLoadingStatsUI() {
    const total = allPoints.length;
    const processed = allPoints.filter(p => p.processed).length;
    const exact = allPoints.filter(p => p.geocoded && !p.isMock && !p.isTemporary).length;
    const approx = allPoints.filter(p => p.isMock && !p.isTemporary).length;
    const pending = total - processed;
    
    // Обновляем элементы если они существуют
    const totalEl = document.getElementById('total-loaded');
    const exactEl = document.getElementById('exact-loaded');
    const approxEl = document.getElementById('approx-loaded');
    const pendingEl = document.getElementById('pending-loaded');
    
    if (totalEl) totalEl.textContent = total;
    if (exactEl) exactEl.textContent = exact;
    if (approxEl) approxEl.textContent = approx;
    if (pendingEl) pendingEl.textContent = pending;
    
    // Обновляем прогресс бар
    updateProgressBar(processed, total);
}

function updateProgressBar(processed, total) {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    if (progressContainer && progressBar && progressText) {
        const percentage = Math.round((processed / total) * 100);
        
        progressContainer.style.display = 'block';
        progressBar.style.width = percentage + '%';
        progressText.textContent = `${processed}/${total} (${percentage}%)`;
    }
}

function showLoadingStats(show) {
    const loadingStats = document.getElementById('loading-stats');
    const progressContainer = document.getElementById('progress-container');
    
    if (loadingStats) {
        loadingStats.style.display = show ? 'grid' : 'none';
    }
    if (progressContainer) {
        progressContainer.style.display = show ? 'block' : 'none';
    }
}

// ========== ОБНОВЛЕННЫЕ ФУНКЦИИ ФИЛЬТРАЦИИ ==========
function applyFilters() {
    // Получаем выбранные значения
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    // Получаем фильтр по точности
    const precisionFilter = document.getElementById('filter-precision');
    if (precisionFilter) {
        activeFilters.precision = precisionFilter.value;
    }
    
    // Обновляем отображение точек
    updatePointsDisplay();
    
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    // Сбрасываем select'ы
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager', 'filter-precision'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            if (select.multiple) {
                // Для multiple select
                Array.from(select.options).forEach(option => option.selected = false);
                if (select.options.length > 0) select.options[0].selected = true;
            } else {
                // Для single select
                select.selectedIndex = 0;
            }
        }
    });
    
    // Сбрасываем активные фильтры
    activeFilters = {
        projects: [],
        regions: [],
        statuses: [],
        managers: [],
        precision: ''
    };
    
    // Показываем все точки
    updatePointsDisplay();
    
    showNotification('Фильтры сброшены', 'success');
}

function updatePointsDisplay() {
    // Фильтруем точки
    const filteredPoints = filterPoints();
    
    // Очищаем карту
    markerCluster.clearLayers();
    displayedPointsCount = 0;
    
    // Добавляем отфильтрованные точки
    filteredPoints.forEach(point => {
        if (point.displayed && point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            displayedPointsCount++;
        }
    });
    
    // Центрируем карту на видимых точках
    const visiblePoints = filteredPoints.filter(p => p.displayed && p.lat && p.lng);
    centerMapOnPoints(visiblePoints);
    
    updateStatistics();
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
        
        // Фильтр по точности
        if (activeFilters.precision) {
            if (activeFilters.precision === 'exact' && (point.isMock || point.isTemporary)) {
                return false;
            } else if (activeFilters.precision === 'approx' && !point.isMock && !point.isTemporary) {
                return false;
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
    updatePointsDisplayWithSearch(results);
    
    showNotification(`Найдено ${results.length} точек`, 'success');
}

function updatePointsDisplayWithSearch(results) {
    // Очищаем карту
    markerCluster.clearLayers();
    
    // Добавляем найденные точки
    results.forEach(point => {
        if (point.displayed && point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    // Центрируем карту на найденных точках
    const pointsWithCoords = results.filter(p => p.lat && p.lng);
    if (pointsWithCoords.length > 0) {
        centerMapOnPoints(pointsWithCoords);
    }
}

// ========== ФУНКЦИЯ УЛУЧШЕНИЯ КООРДИНАТ ==========
async function improveGeocoding() {
    const pointsToImprove = allPoints.filter(p => 
        p.needsImprovement && p.address && !p.isImproving && p.processed
    );
    
    if (pointsToImprove.length === 0) {
        showNotification('Нет точек с приблизительными координатами для уточнения', 'info');
        return;
    }
    
    showModal('Автономное уточнение координат', 
        `Найдено ${pointsToImprove.length} точек для уточнения.\n` +
        `Уточняю координаты в фоновом режиме...`);
    
    let improvedCount = 0;
    
    for (let i = 0; i < pointsToImprove.length; i++) {
        const point = pointsToImprove[i];
        point.isImproving = true;
        
        updateModal('Автономное уточнение координат', 
            `Обрабатываю ${i+1} из ${pointsToImprove.length}...\n` +
            `(${improvedCount} улучшено)\n` +
            `Текущая: ${point.name}`);
        
        try {
            // Используем автономный геокодер для улучшения
            const result = await autonomousGeocoder.geocode(point.address, point.region);
            
            if (result && !result.isApproximate) {
                // Улучшаем точку
                point.lat = result.lat;
                point.lng = result.lng;
                point.coordinates = `${result.lat},${result.lng}`;
                point.source = result.source;
                point.isMock = false;
                point.precision = result.precision || 'high';
                point.needsImprovement = false;
                improvedCount++;
                
                // Обновляем маркер на карте
                updatePointOnMap(point);
            }
            
            // Задержка для API лимитов
            await sleep(1000);
            
        } catch (error) {
            console.warn('Не удалось уточнить:', point.name, error);
        }
        
        point.isImproving = false;
    }
    
    closeModal();
    updateStatistics();
    updateLoadingStatsUI();
    
    if (improvedCount > 0) {
        showNotification(`Уточнены координаты для ${improvedCount} точек`, 'success');
    } else {
        showNotification('Не удалось улучшить координаты. Попробуйте позже.', 'info');
    }
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
    
    // Определяем иконку точности
    let precisionIcon = '🎯';
    let precisionText = 'Высокая';
    let precisionColor = '#2ecc71';
    
    if (point.isTemporary) {
        precisionIcon = '⏳';
        precisionText = 'Идет поиск координат';
        precisionColor = '#95a5a6';
    } else if (point.isMock) {
        precisionIcon = '📍';
        precisionText = 'Приблизительная';
        precisionColor = '#f39c12';
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 5px;">${point.name || 'Без названия'}</h5>
            <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                ${point.status || 'Статус не указан'}
            </span>
            <span style="background: ${precisionColor}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-left: 5px;">
                ${precisionIcon} ${precisionText}
            </span>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
            ${point.address ? `
                <p><strong>Адрес:</strong> ${point.address}</p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p><strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</p>
                <p><small>Источник: ${point.source || 'Неизвестно'}</small></p>
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
        
        ${point.isTemporary ? `
            <div style="margin-top: 15px; padding: 8px; background: #3498db; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-sync-alt fa-spin"></i> Идет поиск точных координат...
            </div>
        ` : point.isMock ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-map-marker-alt"></i> Приблизительные координаты
                ${point.needsImprovement ? '<br><small>Нажмите "Уточнить координаты" для улучшения</small>' : ''}
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========== УТИЛИТЫ ==========
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomCoordinate(type, region) {
    // Базовые координаты по регионам
    const regionCoords = {
        'москва': { lat: 55.7558, lng: 37.6173 },
        'московская': { lat: 55.7539, lng: 37.6208 },
        'ленинградская': { lat: 59.9391, lng: 30.3159 },
        'санкт-петербург': { lat: 59.9343, lng: 30.3351 },
        'алтайский': { lat: 53.3606, lng: 83.7636 },
        'барнаул': { lat: 53.3606, lng: 83.7636 },
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
    
    // Добавляем случайное смещение (меньше для временных точек)
    const offset = 0.5; // Уменьшили для лучшего визуального восприятия
    if (type === 'lat') {
        return baseLat + (Math.random() - 0.5) * offset;
    } else {
        return baseLng + (Math.random() - 0.5) * offset * 2;
    }
}

// ========== ОБНОВЛЕНИЕ ФИЛЬТРОВ ==========
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

function getSelectedValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    
    return Array.from(select.selectedOptions)
        .map(opt => opt.value)
        .filter(val => val !== '');
}

// ========== ОБНОВЛЕНИЕ ЛЕГЕНДЫ ==========
function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    let legendHTML = `
        <div style="margin-bottom: 15px;">
            <strong style="font-size: 12px; color: #666;">Статус загрузки:</strong>
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #3498db; border: 2px solid white; animation: pulse 2s infinite;"></div>
                <span style="font-size: 11px;">Идет поиск координат</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #2ecc71; border: 2px solid white;"></div>
                <span style="font-size: 11px;">Точные координаты</span>
            </div>
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: #f39c12; border: 2px solid white;"></div>
                <span style="font-size: 11px;">Приблизительные</span>
            </div>
        </div>
        
        <div style="border-top: 1px solid #eee; padding-top: 10px;">
            <strong style="font-size: 12px; color: #666;">Статусы точек:</strong>
    `;
    
    // Собираем статусы из данных
    const statuses = new Set();
    allPoints.forEach(point => {
        if (point.status) {
            statuses.add(point.status);
        }
    });
    
    // Добавляем стандартные статусы если нужно
    if (statuses.size < 3) {
        statuses.add('сдан');
        statuses.add('Отправлен ФО, не принят');
        statuses.add('План');
    }
    
    // Создаем элементы легенды для статусов
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
            <div style="display: flex; align-items: center; gap: 10px; margin: 5px 0;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background: ${color}; border: 2px solid white;"></div>
                <span style="font-size: 11px;">${status}</span>
            </div>
        `;
    });
    
    legendHTML += `</div>`;
    
    container.innerHTML = legendHTML;
}

// ========== УТИЛИТЫ ИНТЕРФЕЙСА ==========
function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.innerHTML = message;
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
    
    // Цвет по типу
    let color = '#3498db';
    if (type === 'success') color = '#2ecc71';
    else if (type === 'error') color = '#e74c3c';
    else if (type === 'warning') color = '#f39c12';
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${color};
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

// ========== ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений) ==========

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
        
        // Сразу показываем точки
        const rawPoints = processDataFromObjects(points);
        showPointsImmediately(rawPoints);
        
        // Запускаем фоновое геокодирование
        startProgressiveGeocoding(rawPoints);
        
        updateStatus(`Загружено: ${points.length} точек`);
        showNotification('Данные загружены через CSV', 'success');
        
    } catch (error) {
        console.error('Ошибка альтернативной загрузки:', error);
        showNotification('Не удалось загрузить данные. Проверьте доступ к таблице.', 'error');
        
        // Показываем демо-данные для теста
        showDemoData();
    }
}

function showDemoData() {
    console.log('Показываем демо-данные...');
    
    // Создаем демо-точки для теста
    const demoPoints = [
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
    
    // Сразу показываем точки
    showPointsImmediately(demoPoints);
    allPoints = demoPoints;
    
    updateStatus('Демо-данные загружены');
    showNotification('Используются демо-данные. Проверьте доступ к таблице.', 'warning');
}

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

function processDataFromObjects(objects) {
    const points = [];
    
    objects.forEach((obj, index) => {
        const point = {
            id: `point_${Date.now()}_${index}`,
            name: obj['Название ТТ'] || obj['Магазин'] || 'Без названия',
            region: obj['Регион'] || obj['Область'] || '',
            address: obj['Адрес'] || obj['Местоположение'] || '',
            status: obj['Статус ТТ'] || obj['Статус'] || '',
            manager: obj['Менеджер ФИО'] || obj['Менеджер'] || '',
            contractor: obj['Подрядчик ФИО'] || obj['Подрядчик'] || ''
        };
        
        if (point.name) {
            points.push(point);
        }
    });
    
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

function setupAutoUpdate() {
    if (CONFIG.UPDATE.auto) {
        updateInterval = setInterval(() => {
            if (!isGeocodingActive) {
                loadData();
            }
        }, CONFIG.UPDATE.interval);
        console.log('Автообновление настроено: каждые', CONFIG.UPDATE.interval / 60000, 'минут');
    }
}

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.improveGeocoding = improveGeocoding;
