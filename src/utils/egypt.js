/**
 * Regions & 3-Part Address Helper.
 * البيانات (المحافظات/المناطق والتوقيت) تُقرأ من ملف التخصيص المركزي
 * src/client/config.js — لعميل جديد عدّل config فقط.
 */
import { CLIENT } from '../client/config.js'
import { storageKey } from '../client/storage.js'
import { escapeAttr, escapeHtml } from './escapeHtml.js'

export const EGYPT_GOVERNORATES = CLIENT.region.governorates;

export const CITY_CUSTOM_STORAGE_KEY = storageKey('city_custom_entries');

export function getCustomCities(governorate) {
  try {
    const raw = localStorage.getItem(CITY_CUSTOM_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    if (governorate) return (all[governorate] || []).filter(Boolean);
    return all;
  } catch {
    return governorate ? [] : {};
  }
}

export function addCustomCity(governorate, city) {
  const g = String(governorate || '').trim();
  const c = String(city || '').trim();
  if (!g || !c) return false;
  const base = EGYPT_GOVERNORATES[g] || [];
  if (base.includes(c) || getCustomCities(g).includes(c)) return false;
  const all = getCustomCities();
  all[g] = all[g] || [];
  all[g].push(c);
  try { localStorage.setItem(CITY_CUSTOM_STORAGE_KEY, JSON.stringify(all)); } catch { /* storage full */ }
  return true;
}

export function getCitiesForGovernorate(governorate) {
  const base = EGYPT_GOVERNORATES[governorate] || [];
  const custom = getCustomCities(governorate);
  if (!custom.length) return base;
  return base.concat(custom.filter(c => !base.includes(c)));
}

export function citySelectOptions(governorate, selectedCity) {
  const cities = getCitiesForGovernorate(governorate);
  let html = '<option value="">اختر المدينة / المركز</option>';
  // V3.58 — XSS: أسماء المدن (من config + مدن مخصصة مخزنة محلياً بإدخال مستخدم)
  // تُهرَّب في القيمة والـ text — أي اسم يحمل `<script>` أو اقتباساً لا يكسر
  // البنية ولا ينفّذ.
  cities.forEach(c => {
    html += `<option value="${escapeAttr(c)}"${c === selectedCity ? ' selected' : ''}>${escapeHtml(c)}</option>`;
  });
  html += `<option value="__other__"${selectedCity && !cities.includes(selectedCity) ? ' selected' : ''}>أخرى (إدخال يدوي)...</option>`;
  return html;
}

/** Binds a governorate select to a city select and an optional manual-city input. */
export function setupCitySelect(opts) {
  const govSel = opts.governorateSelect;
  const citySel = opts.citySelect;
  const manualInput = opts.manualInput;
  if (!govSel || !citySel) return;

  const refreshCities = (governorate, selectedCity) => {
    const gov = governorate || govSel.value || '';
    citySel.innerHTML = citySelectOptions(gov, selectedCity);
  };

  govSel.addEventListener('change', () => {
    refreshCities(govSel.value, '');
    if (manualInput) {
      manualInput.value = '';
      manualInput.style.display = 'none';
    }
    if (opts.onCityChange) opts.onCityChange('', citySel.value);
  });

  citySel.addEventListener('change', () => {
    const isOther = citySel.value === '__other__';
    if (manualInput) {
      manualInput.style.display = isOther ? 'block' : 'none';
      if (!isOther) manualInput.value = '';
    }
    if (!isOther) {
      const city = getCitiesForGovernorate(govSel.value).includes(citySel.value) ? citySel.value : '';
      if (opts.onCityChange) opts.onCityChange(city, citySel.value);
    }
  });

  if (manualInput) {
    manualInput.style.display = 'none';
    manualInput.addEventListener('change', () => {
      const val = manualInput.value.trim();
      if (!val) return;
      addCustomCity(govSel.value, val);
      citySel.innerHTML = citySelectOptions(govSel.value, val);
      if (opts.onCityChange) opts.onCityChange(val, citySel.value);
    });
  }
}

/** reads the effective city from a citySelect + manualInput pair */
export function getEffectiveCity(citySelect, manualInput) {
  if (!citySelect) return '';
  const manualVal = manualInput ? manualInput.value.trim() : '';
  if (citySelect.value === '__other__') return manualVal;
  return citySelect.value;
}

/** Parse combined 3-part address string into components */
export function parseAddressComponents(fullAddressStr) {
  const defaultGov = CLIENT.region.defaultGovernorate;
  const defaultCity = (CLIENT.region.governorates[defaultGov] || [])[0] || '';
  if (!fullAddressStr) return { governorate: defaultGov, city: defaultCity, details: '' };

  const parts = fullAddressStr.split(' - ');
  if (parts.length >= 2 && EGYPT_GOVERNORATES[parts[0]]) {
    return {
      governorate: parts[0],
      city: parts[1],
      details: parts.slice(2).join(' - ')
    };
  }
  return { governorate: defaultGov, city: defaultCity, details: fullAddressStr };
}

/**
 * Resolve a free-form Egyptian address string (from AI form-fill, chat, or paste)
 * into the tri-state address fields { governorate, city, details }.
 * Falls back to matching a known city name anywhere in the string, then to the
 * fallback governorate. Unlike parseAddressComponents it never fabricates a city.
 */
export function matchEgyptAddress(addressStr, fallbackGov = CLIENT.region.defaultGovernorate) {
  const govs = Object.keys(EGYPT_GOVERNORATES);
  const str = String(addressStr || '').trim();
  if (!str) return { governorate: fallbackGov, city: '', details: '' };

  const parts = str.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  let governorate = '';
  let city = '';
  let details = '';

  if (parts.length >= 2 && EGYPT_GOVERNORATES[parts[0]]) {
    governorate = parts[0];
    city = parts[1];
    details = parts.slice(2).join(' - ');
  } else {
    for (const g of govs) {
      const hit = getCitiesForGovernorate(g).find(c => str.includes(c));
      if (hit && hit.length > city.length) {
        governorate = g;
        city = hit;
      }
    }
    if (!governorate && parts.length === 1 && EGYPT_GOVERNORATES[parts[0]]) {
      governorate = parts[0];
    }
    if (!governorate) details = str;
  }

  return { governorate: governorate || fallbackGov, city, details };
}
