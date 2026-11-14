import { createContext, useContext } from 'react';
import type { CityData } from './types';
import { CITIES } from './lib/places';

/** The city the app is currently set to. */
export const CityContext = createContext<CityData>(CITIES[0]);
export const useCity = () => useContext(CityContext);
