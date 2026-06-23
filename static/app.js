'use strict';

const DEST_NAMES = { PRG: 'Prague', BER: 'Berlin', MUC: 'Munich', VIE: 'Vienna' };
const ORIGIN_NAMES = {
  LHR: 'Heathrow', LGW: 'Gatwick', STN: 'Stansted', LTN: 'Luton',
  LCY: 'City', MAN: 'Manchester', EDI: 'Edinburgh', BHX: 'Birmingham', BRS: 'Bristol',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDuration(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPrice(offer, currency) {
  if (offer.price_gbp === null || offer.price_gbp === undefined) return null;
  const sym = currency === 'EUR' ? '€' : '£';
  return `${sym}${Math.round(offer.price_gbp)}`;
}

function priceBadgeClass(price, minPrice, maxPrice) {
  if (price === null) return 'price-none';
  const range = maxPrice - minPrice;
  if (range === 0 || price <= minPrice + range * 0.33) return 'price-cheap';
  if (price <= minPrice + range * 0.66) return 'price-mid';
  return 'price-high';
}

function getChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

// ── Table builders ────────────────────────────────────────────────────────────

function buildFlightTable(offers, currency) {
  if (offers.length === 0) return '<p class="text-gray-500 text-sm py-4">No flight results. Check your Amadeus credentials in .env</p>';

  const prices = offers.map(o => o.price_gbp).filter(p => p !== null);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  // Group by destination
  const byDest = {};
  for (const offer of offers) {
    const dest = offer.destination;
    if (!byDest[dest]) byDest[dest] = [];
    byDest[dest].push(offer);
  }

  let html = '';
  for (const [dest, destOffers] of Object.entries(byDest)) {
    html += `<div class="dest-header">${DEST_NAMES[dest] || dest}</div>`;
    html += `<div class="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">`;
    html += `<table class="results-table"><thead><tr>
      <th>Date</th><th>From</th><th>Depart</th><th>Arrive</th>
      <th>Duration</th><th>Carrier</th><th>Stops</th><th>Price</th><th>Seats</th>
    </tr></thead><tbody>`;

    for (const offer of destOffers) {
      const priceVal = offer.price_gbp;
      const priceStr = fmtPrice(offer, currency) || '—';
      const badgeClass = priceBadgeClass(priceVal, minPrice, maxPrice);
      const stopStr = offer.stops === 0 ? '<span class="text-green-400 text-xs">Direct</span>'
        : `<span class="stop-badge">${offer.stops} stop${offer.stops > 1 ? 's' : ''}</span>`;
      const seatsStr = offer.seats_available !== null ? offer.seats_available : '—';
      const carrier = offer.segments[0]?.number || '—';
      const originCode = offer.origin;

      html += `<tr>
        <td class="text-gray-300">${fmtDate(offer.departure)}</td>
        <td><span class="font-mono text-blue-400 text-xs">${originCode}</span>
            <span class="text-gray-500 text-xs ml-1">${ORIGIN_NAMES[originCode] || ''}</span></td>
        <td class="font-mono text-white">${fmtTime(offer.departure)}</td>
        <td class="font-mono text-white">${fmtTime(offer.arrival)}</td>
        <td class="text-gray-300">${fmtDuration(offer.duration_minutes)}</td>
        <td class="text-gray-400 text-xs">${carrier}</td>
        <td>${stopStr}</td>
        <td><span class="price-badge ${badgeClass}">${priceStr}</span></td>
        <td class="text-gray-500 text-xs">${seatsStr}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }
  return html;
}

function buildTrainTable(offers) {
  if (offers.length === 0) {
    return '<p class="text-gray-500 text-sm py-4">No train results returned from DB Hafas. Try the fallback links below.</p>';
  }

  const byDest = {};
  for (const offer of offers) {
    const dest = offer.destination;
    if (!byDest[dest]) byDest[dest] = [];
    byDest[dest].push(offer);
  }

  let html = '';
  for (const [dest, destOffers] of Object.entries(byDest)) {
    const destLabel = Object.values(DEST_NAMES).find(n => destOffers[0]?.destination?.includes(n))
      || dest;
    html += `<div class="dest-header">${destLabel}</div>`;
    html += `<div class="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">`;
    html += `<table class="results-table"><thead><tr>
      <th>Date</th><th>Route</th><th>Depart</th><th>Arrive</th>
      <th>Duration</th><th>Legs</th><th>Price</th><th>Book</th>
    </tr></thead><tbody>`;

    for (const offer of destOffers) {
      const isUrlFallback = offer.source === 'url_fallback';
      const routeStr = offer.segments.map(s => {
        const o = s.origin.replace('International', '').replace('London ', '').trim();
        return o.substring(0, 12);
      }).join(' → ');
      const priceStr = offer.price_gbp !== null ? `€${Math.round(offer.price_gbp)}` : null;
      const bookLink = offer.deep_link
        ? `<a href="${offer.deep_link}" target="_blank" rel="noopener" class="book-link">Book →</a>`
        : '—';

      html += `<tr class="${isUrlFallback ? 'opacity-60' : ''}">
        <td class="text-gray-300">${fmtDate(offer.departure)}</td>
        <td class="text-gray-400 text-xs max-w-xs truncate">${routeStr}</td>
        <td class="font-mono text-white">${isUrlFallback ? '—' : fmtTime(offer.departure)}</td>
        <td class="font-mono text-white">${isUrlFallback ? '—' : fmtTime(offer.arrival)}</td>
        <td class="text-gray-300">${offer.duration_minutes ? fmtDuration(offer.duration_minutes) : '—'}</td>
        <td class="text-gray-500 text-xs">${offer.segments.length}</td>
        <td><span class="price-badge ${priceStr ? 'price-cheap' : 'price-none'}">${priceStr || 'Check site'}</span></td>
        <td>${bookLink}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }
  return html;
}

// ── Search ─────────────────────────────────────────────────────────────────────

async function doSearch() {
  const origins = getChecked('origin');
  const destinations = getChecked('dest');
  const daysFrom = parseInt(document.getElementById('days-from').value, 10);
  const daysTo = parseInt(document.getElementById('days-to').value, 10);
  const sort = document.getElementById('sort-select').value;
  const currency = document.getElementById('currency-select').value;

  if (!origins.length || !destinations.length) {
    showError('Please select at least one departure airport and one destination.');
    return;
  }

  const daysParam = `${daysFrom}..${daysTo}`;
  const btn = document.getElementById('search-btn');
  btn.disabled = true;
  document.getElementById('search-label').textContent = 'Searching…';

  document.getElementById('status-bar').classList.remove('hidden');
  document.getElementById('status-text').textContent = 'Fetching flights and trains…';
  document.getElementById('error-banner').classList.add('hidden');
  document.getElementById('results-section').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');

  const flightParams = new URLSearchParams({
    origins: origins.join(','),
    destinations: destinations.join(','),
    days: daysParam,
    sort,
    currency,
  });
  const trainParams = new URLSearchParams({
    destinations: destinations.join(','),
    days: daysParam,
  });

  try {
    const [flightRes, trainRes] = await Promise.all([
      fetch(`/api/flights?${flightParams}`),
      fetch(`/api/trains?${trainParams}`),
    ]);

    if (!flightRes.ok) throw new Error(`Flights API error: ${flightRes.status}`);
    if (!trainRes.ok) throw new Error(`Trains API error: ${trainRes.status}`);

    const [flightData, trainData] = await Promise.all([flightRes.json(), trainRes.json()]);

    document.getElementById('flights-container').innerHTML = buildFlightTable(flightData.offers || [], currency);
    document.getElementById('trains-container').innerHTML = buildTrainTable(trainData.offers || []);

    document.getElementById('flight-count').textContent = flightData.count || 0;
    document.getElementById('train-count').textContent = trainData.count || 0;

    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('status-bar').classList.add('hidden');
  } catch (err) {
    showError(err.message || 'An error occurred. Check the console for details.');
    document.getElementById('status-bar').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    document.getElementById('search-label').textContent = 'Search';
  }
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.classList.remove('hidden');
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('tab-flights').classList.toggle('hidden', tab !== 'flights');
    document.getElementById('tab-trains').classList.toggle('hidden', tab !== 'trains');
  });
});

// ── Days label update ─────────────────────────────────────────────────────────

function updateDaysLabel() {
  const from = document.getElementById('days-from').value;
  const to = document.getElementById('days-to').value;
  const today = new Date();
  const fmtOffset = (n) => {
    const d = new Date(today);
    d.setDate(today.getDate() + parseInt(n, 10));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  document.getElementById('days-label').textContent = `${fmtOffset(from)} – ${fmtOffset(to)}`;
}

document.getElementById('days-from').addEventListener('input', updateDaysLabel);
document.getElementById('days-to').addEventListener('input', updateDaysLabel);
updateDaysLabel();

document.getElementById('search-btn').addEventListener('click', doSearch);
