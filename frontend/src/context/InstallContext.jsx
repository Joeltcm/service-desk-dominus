import React, { createContext, useContext, useEffect, useState } from 'react'

const InstallContext = createContext(null)

export function InstallProvider({ children }) {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches
  )

  useEffect(() => {
    const handler = (e) => {
      // Suppresses the browser's automatic mini-infobar so the saved event
      // can be replayed later from our own custom install button instead.
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const mq = window.matchMedia('(display-mode: standalone)')
    const mqHandler = (e) => setIsInstalled(e.matches)
    mq.addEventListener('change', mqHandler)

    const installedHandler = () => {
      setInstallPrompt(null)
      setIsInstalled(true)
    }
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      mq.removeEventListener('change', mqHandler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const install = async () => {
    if (!installPrompt) return false
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
    return outcome === 'accepted'
  }

  return (
    <InstallContext.Provider value={{ canInstall: !!installPrompt && !isInstalled, isInstalled, install }}>
      {children}
    </InstallContext.Provider>
  )
}

export const useInstall = () => useContext(InstallContext)
