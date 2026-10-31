import { model } from 'geomagnetism'
import type proj4 from 'proj4'
import { sheetGrid, type Sheet } from './sheet'

const DEG = Math.PI / 180

/** Web Mercator world coordinates in [0, 1], y down. */
export function mercator([lon, lat]: number[]): [number, number] {
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / Math.PI) / 2]
}

/**
 * Azimuth of grid north of a UTM grid at a point, in degrees clockwise from true north
 * (positive when grid north lies east of true north). Measured on Web Mercator, which is conformal.
 */
export function convergenceAt(conv: proj4.Converter, point: [number, number]): number {
  const [e, n] = conv.forward(point)
  const [x0, y0] = mercator(conv.inverse([e, n - 500]))
  const [x1, y1] = mercator(conv.inverse([e, n + 500]))
  return Math.atan2(x1 - x0, y0 - y1) / DEG
}

/** Grid convergence of the sheet's grid at the sheet centre. */
export function gridConvergence(sheet: Sheet): number {
  return convergenceAt(sheetGrid(sheet).conv, sheet.center)
}

export interface NorthInfo {
  /** Grid convergence (grid north relative to true north), degrees, east positive. */
  convergence: number
  /** Magnetic declination (magnetic north relative to true north), degrees, east positive. */
  declination: number
  /** Annual change of declination, degrees per year, east positive. */
  annualChange: number
  /** Grid–magnetic angle (magnetic north relative to grid north), degrees, east positive. */
  gridMagnetic: number
  year: number
}

export function northInfo(sheet: Sheet, date: Date): NorthInfo {
  const [lon, lat] = sheet.center
  const opts = { allowOutOfBoundsModel: true }
  const declination = model(date, opts).point([lat, lon]).decl
  const nextYear = new Date(date)
  nextYear.setFullYear(date.getFullYear() + 1)
  const annualChange = model(nextYear, opts).point([lat, lon]).decl - declination
  const convergence = gridConvergence(sheet)
  return { convergence, declination, annualChange, gridMagnetic: declination - convergence, year: date.getFullYear() }
}

/** NATO mils: 6400 per full circle. */
export function toMils(degrees: number) {
  return Math.round((degrees * 6400) / 360)
}

/** "2.4° W (43 mils)" */
export function formatAngle(degrees: number, decimals = 1) {
  const dir = degrees >= 0 ? 'E' : 'W'
  return `${Math.abs(degrees).toFixed(decimals)}° ${dir} (${Math.abs(toMils(degrees))} mils)`
}
