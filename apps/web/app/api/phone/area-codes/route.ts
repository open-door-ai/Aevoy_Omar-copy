import { NextResponse } from "next/server";

/**
 * Popular US Area Codes by Region
 * Organized by major cities and regions for easy selection
 */
export interface AreaCode {
  code: string;
  city: string;
  state: string;
  region: string;
  country: "US" | "CA";
}

const POPULAR_AREA_CODES: AreaCode[] = [
  // West Coast
  { code: "310", city: "Los Angeles", state: "CA", region: "West", country: "US" },
  { code: "323", city: "Los Angeles", state: "CA", region: "West", country: "US" },
  { code: "213", city: "Los Angeles", state: "CA", region: "West", country: "US" },
  { code: "424", city: "Los Angeles", state: "CA", region: "West", country: "US" },
  { code: "415", city: "San Francisco", state: "CA", region: "West", country: "US" },
  { code: "510", city: "Oakland", state: "CA", region: "West", country: "US" },
  { code: "650", city: "Palo Alto", state: "CA", region: "West", country: "US" },
  { code: "408", city: "San Jose", state: "CA", region: "West", country: "US" },
  { code: "619", city: "San Diego", state: "CA", region: "West", country: "US" },
  { code: "858", city: "San Diego", state: "CA", region: "West", country: "US" },
  { code: "206", city: "Seattle", state: "WA", region: "West", country: "US" },
  { code: "425", city: "Bellevue", state: "WA", region: "West", country: "US" },
  { code: "503", city: "Portland", state: "OR", region: "West", country: "US" },
  { code: "971", city: "Portland", state: "OR", region: "West", country: "US" },
  { code: "702", city: "Las Vegas", state: "NV", region: "West", country: "US" },
  { code: "725", city: "Las Vegas", state: "NV", region: "West", country: "US" },

  // East Coast
  { code: "212", city: "Manhattan", state: "NY", region: "East", country: "US" },
  { code: "646", city: "Manhattan", state: "NY", region: "East", country: "US" },
  { code: "917", city: "New York City", state: "NY", region: "East", country: "US" },
  { code: "718", city: "Brooklyn", state: "NY", region: "East", country: "US" },
  { code: "347", city: "Brooklyn", state: "NY", region: "East", country: "US" },
  { code: "929", city: "Queens", state: "NY", region: "East", country: "US" },
  { code: "516", city: "Long Island", state: "NY", region: "East", country: "US" },
  { code: "631", city: "Long Island", state: "NY", region: "East", country: "US" },
  { code: "617", city: "Boston", state: "MA", region: "East", country: "US" },
  { code: "857", city: "Boston", state: "MA", region: "East", country: "US" },
  { code: "202", city: "Washington DC", state: "DC", region: "East", country: "US" },
  { code: "301", city: "Maryland", state: "MD", region: "East", country: "US" },
  { code: "240", city: "Maryland", state: "MD", region: "East", country: "US" },
  { code: "215", city: "Philadelphia", state: "PA", region: "East", country: "US" },
  { code: "267", city: "Philadelphia", state: "PA", region: "East", country: "US" },
  { code: "305", city: "Miami", state: "FL", region: "East", country: "US" },
  { code: "786", city: "Miami", state: "FL", region: "East", country: "US" },
  { code: "954", city: "Fort Lauderdale", state: "FL", region: "East", country: "US" },
  { code: "407", city: "Orlando", state: "FL", region: "East", country: "US" },

  // Central
  { code: "312", city: "Chicago", state: "IL", region: "Central", country: "US" },
  { code: "773", city: "Chicago", state: "IL", region: "Central", country: "US" },
  { code: "872", city: "Chicago", state: "IL", region: "Central", country: "US" },
  { code: "214", city: "Dallas", state: "TX", region: "Central", country: "US" },
  { code: "469", city: "Dallas", state: "TX", region: "Central", country: "US" },
  { code: "972", city: "Dallas", state: "TX", region: "Central", country: "US" },
  { code: "713", city: "Houston", state: "TX", region: "Central", country: "US" },
  { code: "281", city: "Houston", state: "TX", region: "Central", country: "US" },
  { code: "832", city: "Houston", state: "TX", region: "Central", country: "US" },
  { code: "512", city: "Austin", state: "TX", region: "Central", country: "US" },
  { code: "737", city: "Austin", state: "TX", region: "Central", country: "US" },
  { code: "210", city: "San Antonio", state: "TX", region: "Central", country: "US" },
  { code: "303", city: "Denver", state: "CO", region: "Central", country: "US" },
  { code: "720", city: "Denver", state: "CO", region: "Central", country: "US" },
  { code: "602", city: "Phoenix", state: "AZ", region: "Central", country: "US" },
  { code: "480", city: "Phoenix", state: "AZ", region: "Central", country: "US" },
  { code: "623", city: "Phoenix", state: "AZ", region: "Central", country: "US" },
  { code: "314", city: "St. Louis", state: "MO", region: "Central", country: "US" },
  { code: "816", city: "Kansas City", state: "MO", region: "Central", country: "US" },

  // South
  { code: "404", city: "Atlanta", state: "GA", region: "South", country: "US" },
  { code: "678", city: "Atlanta", state: "GA", region: "South", country: "US" },
  { code: "470", city: "Atlanta", state: "GA", region: "South", country: "US" },
  { code: "504", city: "New Orleans", state: "LA", region: "South", country: "US" },
  { code: "985", city: "New Orleans", state: "LA", region: "South", country: "US" },
  { code: "704", city: "Charlotte", state: "NC", region: "South", country: "US" },
  { code: "980", city: "Charlotte", state: "NC", region: "South", country: "US" },
  { code: "615", city: "Nashville", state: "TN", region: "South", country: "US" },
  { code: "629", city: "Nashville", state: "TN", region: "South", country: "US" },

  // Canada
  { code: "604", city: "Vancouver", state: "BC", region: "Canada", country: "CA" },
  { code: "778", city: "Vancouver", state: "BC", region: "Canada", country: "CA" },
  { code: "416", city: "Toronto", state: "ON", region: "Canada", country: "CA" },
  { code: "647", city: "Toronto", state: "ON", region: "Canada", country: "CA" },
  { code: "514", city: "Montreal", state: "QC", region: "Canada", country: "CA" },
  { code: "438", city: "Montreal", state: "QC", region: "Canada", country: "CA" },
  { code: "403", city: "Calgary", state: "AB", region: "Canada", country: "CA" },
  { code: "587", city: "Calgary", state: "AB", region: "Canada", country: "CA" },
  { code: "613", city: "Ottawa", state: "ON", region: "Canada", country: "CA" },
];

/**
 * GET /api/phone/area-codes
 * Returns list of popular area codes organized by region
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get("region");
  const country = searchParams.get("country");

  let filteredCodes = POPULAR_AREA_CODES;

  if (region) {
    filteredCodes = filteredCodes.filter(
      (ac) => ac.region.toLowerCase() === region.toLowerCase()
    );
  }

  if (country) {
    filteredCodes = filteredCodes.filter(
      (ac) => ac.country === country.toUpperCase()
    );
  }

  // Group by region for easier display
  const grouped = filteredCodes.reduce((acc, code) => {
    const key = code.region;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(code);
    return acc;
  }, {} as Record<string, AreaCode[]>);

  return NextResponse.json({
    areaCodes: filteredCodes,
    grouped,
    regions: [...new Set(POPULAR_AREA_CODES.map((ac) => ac.region))],
    countries: ["US", "CA"],
  });
}
