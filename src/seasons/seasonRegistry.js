import { springSeason } from './spring.js';
import { summerSeason } from './summer.js';
import { autumnSeason } from './autumn.js';
import { winterSeason } from './winter.js';

export const seasonRegistry = {
  spring: springSeason,
  summer: summerSeason,
  autumn: autumnSeason,
  winter: winterSeason,
};

export const seasonOrder = ['spring', 'summer', 'autumn', 'winter'];