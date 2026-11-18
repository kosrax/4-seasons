import React from 'react';
import { seasonOrder, seasonRegistry } from '../../seasons/seasonRegistry.js';

export function SeasonSelector({ activeSeasonId, onSelectSeason }) {
  return (
    <nav className="season-selector" aria-label="Seasonal typography presets">
      <ul className="season-list">
        {seasonOrder.map((seasonId) => {
          const season = seasonRegistry[seasonId];
          const isImplemented = season.status === 'implemented';
          const isActive = activeSeasonId === seasonId;

          return (
            <li key={season.id} className="season-item">
              <button
                type="button"
                disabled={!isImplemented}
                className={[
                  'season-button',
                  isActive ? 'is-active' : '',
                  !isImplemented ? 'is-planned' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectSeason(season.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="season-name">{season.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}