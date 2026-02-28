import React from 'react'
import ReactDOM from 'react-dom/client'
import { MindPadApp } from './MindPadApp'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.StrictMode>
		<MindPadApp />
	</React.StrictMode>
)
