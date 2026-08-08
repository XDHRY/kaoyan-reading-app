import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { NativeGate } from "@/components/ServerConfig"
import App from './App.tsx'
import { installErrorCapture } from '@/lib/errorLog'

installErrorCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NativeGate>
        <TRPCProvider>
          <App />
        </TRPCProvider>
      </NativeGate>
    </BrowserRouter>
  </StrictMode>,
)
