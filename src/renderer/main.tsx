import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { installAgentCapture } from './lib/agentCapture'
import { applyTheme, useWorkspace } from './stores/workspace'
import { applyLocale } from './config/i18n'
import './styles/globals.css'

installAgentCapture() // lets the MCP server screenshot a named region (main drives it via executeJavaScript)
applyTheme(useWorkspace.getState().theme) // index.html hard-pins .dark; honor the saved mode before first paint
applyLocale(useWorkspace.getState().uiLocale) // honor the saved UI language before first paint (config/i18n)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
