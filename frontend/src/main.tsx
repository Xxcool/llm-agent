import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// 供自动化截图/测试使用：URL 带 #noanim 时禁用动画
if (window.location.hash.includes('noanim')) {
  document.documentElement.classList.add('no-anim')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
