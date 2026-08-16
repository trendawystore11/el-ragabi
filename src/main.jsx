// تحميل Firebase SDK أولاً (يُثبّت window.firebase/db/auth قبل أي خدمة أخرى)
import './services/firebaseLoader.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './legacy/compat.js'
import { showToast } from './ui/components/toastStore.js'
import App from './App.jsx'

// جسر تنبيهات موحّد: الخدمات القديمة (db/sheets/excel) تستدعي window.showToast —
// لم تكن معرّفة في بناء React فكانت التنبيهات تموت صامتة (وحتى export كانت
// يتعطل بسبب TypeError). نربطها الآن بمخزن التنبيهات React نفسه.
window.showToast = showToast

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
