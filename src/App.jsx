import React, { useState, useCallback, useEffect } from 'react';
import { seasonRegistry, seasonOrder } from './seasons/seasonRegistry.js';
import { SceneCanvas } from './components/scene/SceneCanvas.jsx';
import { SeasonSelector } from './components/ui/SeasonSelector.jsx';
import { ResetButton } from './components/ui/ResetButton.jsx';

export function App() {
  const [activeSeasonId, setActiveSeasonId] = useState('spring');
  const [dimensionMode, setDimensionMode] = useState('3d');
  const [resetSignal, setResetSignal] = useState(0);
  const [interactionState, setInteractionState] = useState({
    isRotated: false,
    isDragging: false,
  });

  const activeSeason = seasonRegistry[activeSeasonId];

  const handleSelectSeason = useCallback((seasonId) => {
    const target = seasonRegistry[seasonId];
    if (!target || target.status !== 'implemented') return;
    setActiveSeasonId(seasonId);
  }, []);

  const handleToggleDimension = useCallback(() => {
    setDimensionMode((prev) => (prev === '3d' ? '2d' : '3d'));
  }, []);

  const handleResetOrientation = useCallback(() => {
    setResetSignal((prev) => prev + 1);
  }, []);

  // Keyboard shortcuts 1, 2, 3, 4 to switch between Spring, Summer, Autumn, and Winter
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const index = parseInt(e.key, 10) - 1;
      if (index >= 0 && index < seasonOrder.length) {
        handleSelectSeason(seasonOrder[index]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectSeason]);

  const isViewPanned =
    dimensionMode === '3d' &&
    (interactionState.isRotated || interactionState.isDragging);

  const dynamicThemeStyles = {
    '--bg-obsidian': activeSeason.palette.background,
    '--text-alabaster': activeSeason.palette.textPrimary,
    '--accent-celadon': activeSeason.palette.accentPrimary,
  };

  return (
    <main className="installation-shell" style={dynamicThemeStyles}>
      <SceneCanvas
        seasonConfig={activeSeason}
        resetSignal={resetSignal}
        dimensionMode={dimensionMode}
        onToggleDimension={handleToggleDimension}
        onInteractionStateChange={setInteractionState}
      />

      <div className="interface-overlay">
        <header className="installation-header">
          <h1 className="project-title">FOUR SEASONS</h1>
          <span className="meta-index" aria-live="polite">
            {activeSeason.index} / {activeSeason.name}
          </span>
        </header>

        <section
          className="supporting-caption-stage"
          aria-label="Seasonal theme"
        >
          <p
            key={activeSeason.id}
            className={`supporting-caption ${
              isViewPanned ? 'is-hidden' : ''
            }`}
          >
            {activeSeason.supportingText}
          </p>
        </section>

        <footer className="installation-footer">
          <SeasonSelector
            activeSeasonId={activeSeasonId}
            onSelectSeason={handleSelectSeason}
          />

          <ResetButton
            isRotated={dimensionMode === '3d' && interactionState.isRotated}
            onReset={handleResetOrientation}
          />
        </footer>
      </div>
    </main>
  );
}

export default App;
