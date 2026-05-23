import * as Location from "expo-location";

export type LocationResult = {
  coords: Location.LocationObjectCoords;
  name: string; // human-readable place name
};

export const getCurrentLocationWithName = async (): Promise<LocationResult | null> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const [geo] = await Location.reverseGeocodeAsync({
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  });

  // Build a clean location name
  const parts = [
    geo?.name,
    geo?.district || geo?.subregion,
    geo?.city || geo?.region,
  ].filter(Boolean);

  const name = parts.join(", ") || geo?.formattedAddress || "Unknown location";

  return { coords: location.coords, name };
};