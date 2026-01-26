[file name]: geocoding-worker.js
[file content begin]
// Веб-воркер для фонового геокодирования
self.onmessage = function(event) {
    const { type, data } = event.data;
    
    if (type === 'geocode_batch') {
        geocodeBatch(data.addresses)
            .then(results => {
                self.postMessage({
                    type: 'geocode_results',
                    data: { results }
                });
            })
            .catch(error => {
                self.postMessage({
                    type: 'geocode_error',
                    data: { error: error.message }
                });
            });
    }
};

async function geocodeBatch(addresses) {
    const results = [];
    
    for (let i = 0; i < addresses.length; i++) {
        const address = addresses[i];
        try {
            const coords = await geocodeAddress(address);
            results.push({
                address,
                success: true,
                coords
            });
            
            // Задержка между запросами (1 сек)
            if (i < addresses.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
        } catch (error) {
            results.push({
                address,
                success: false,
                error: error.message
            });
        }
        
        // Отправляем прогресс
        self.postMessage({
            type: 'geocode_progress',
            data: {
                processed: i + 1,
                total: addresses.length
            }
        });
    }
    
    return results;
}

async function geocodeAddress(address) {
    // Используем OpenStreetMap Nominatim
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=ru`;
    
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'TTMapApp/1.0',
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
    
    throw new Error('Адрес не найден');
}
[file content end]
