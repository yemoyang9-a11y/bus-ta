export interface Station {
  stationName: string;
  latitude: number;
  longitude: number;
  /** stationList 항목에는 필수, boarding/destination 객체에는 생략 가능 */
  sequence?: number;
}

export interface StationListItem extends Station {
  sequence: number;
}
