import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'inline-flex items-center gap-2 min-h-[40px] px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0'
            : 'inline-flex items-center justify-center gap-2 min-h-[44px] w-full px-4 py-2.5 text-sm font-semibold rounded-xl bg-[#0F213D] text-white hover:bg-[#18335C] dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors whitespace-nowrap'
        }
      >
        {isInstallable ? <Download className="w-4 h-4 shrink-0" /> : <Smartphone className="w-4 h-4 shrink-0" />}
        <span>{isInstallable ? 'Instalar app' : 'Instalar en móvil'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h3 id="pwa-guide-title" className="text-lg font-bold text-slate-900 dark:text-white font-display">
                Instalar No me lavo en tu teléfono
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Cerrar guía de instalación"
                className="min-h-[40px] min-w-[40px] -mt-1 -mr-1 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {isIOS
                ? 'En Safari (iPhone o iPad), pulsa el botón Compartir en la barra inferior y elige "Agregar a pantalla de inicio".'
                : 'Abre el menú de tu navegador móvil (Chrome, Edge o Safari) y selecciona "Instalar aplicación" o "Agregar a pantalla de inicio" para usar No me lavo en pantalla completa.'}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-sm font-semibold hover:bg-slate-800 dark:hover:bg-blue-500 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 z-50 flex items-center gap-2.5 rounded-2xl bg-amber-600 text-white px-4 py-3 text-xs font-medium shadow-lg max-w-sm"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Sin conexión a internet. Mostrando los últimos datos almacenados en caché.</span>
    </div>
  );
};
