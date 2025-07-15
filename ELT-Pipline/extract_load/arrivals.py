#!/usr/bin/env python3
"""
Flight Stats Scraper for Tunisia
Modernized version — 2025
"""

import datetime as dt
import json
import logging
import os
import re
from os import path
from typing import List, Dict

import pandas as pd
import requests
from sqlalchemy import text

from util.database import DatabaseConnection
from util.tools import create_dir
from util.yaml_config import read_yaml_file

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger()
# Enable DEBUG to see detailed logs (including response snippets)
logger.setLevel(logging.DEBUG)

# Display options
pd.set_option('display.max_columns', 150)
pd.set_option('display.width', 150)

# Paths
PARENT_PATH = path.dirname(__file__)
ROOT_PATH = path.abspath(path.join(PARENT_PATH, '..'))
ROOTER_PATH = path.abspath(path.join(PARENT_PATH, '..', '..'))

DBT_DATA_DIR = path.join(ROOT_PATH, 'dbt/data')
OUTPUT_DIR = path.join(PARENT_PATH, 'output')

# Config
CONFIG = read_yaml_file(path.join(PARENT_PATH, 'config.yaml'))
COLUMN_HEADERS = CONFIG['HEADERS']
BASE_WEBSITE = CONFIG['WEBSITE']['ARRIVALS']

HTTP_HEADERS = CONFIG.get('HTTP_HEADERS', {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
})

CRED = read_yaml_file(path.join(PARENT_PATH, 'cred/credentials.yaml'))
POSTGRES_CRED = CRED['POSTGRES_CRED']
PG_URL = f"postgresql+psycopg2://{POSTGRES_CRED['user']}:{POSTGRES_CRED['password']}@{POSTGRES_CRED['host']}:{POSTGRES_CRED['port']}/{POSTGRES_CRED['dbname']}"

INPUT_FILE_NAME = CONFIG['OUTPUT']['FILE_NAME']['AIRPORTS']
OUTPUT_FILE_NAME = CONFIG['OUTPUT']['FILE_NAME']['ARRIVALS']


def main() -> None:
    tmr = dt.date.today() + dt.timedelta(days=1)
    logging.info(f"Scraping flight data for Tunisia on {tmr}")

    airport_codes = get_airport_code_list('ICAO', 'Tunisia')
    logging.info(f"Tunisian Airport ICAO codes: {airport_codes}")

    valid_hours = [0, 6, 12, 18]
    flights = []

    for airport_code in airport_codes:
        for hour in valid_hours:
            flights.extend(scrap_flight_stats(airport_code, tmr.year, tmr.month, tmr.day, hour))

    if not flights:
        logging.warning("No flight data found!")
        return

    df = pd.json_normalize(flights)
    df.columns = df.columns.str.replace('.', '_')

    create_dir(OUTPUT_DIR, to_clear=False)

    output_paths = [
        path.join(DBT_DATA_DIR, OUTPUT_FILE_NAME),
        path.join(OUTPUT_DIR, OUTPUT_FILE_NAME)
    ]

    for file_path in output_paths:
        logging.info(f"Saving data to {file_path}")
        df.to_csv(file_path, index=False, encoding='utf-8')

    logging.info("Sample Results:\n%s", df.head())
    logging.info("Done")


def get_airport_code_list(iata_or_icao: str = 'ICAO', country: str = 'Tunisia') -> List[str]:
    try:
        logging.info(f"Fetching airport code list ({iata_or_icao}) for {country} from database...")
        return get_airport_code_list_db(iata_or_icao, country)
    except Exception as e:
        logging.warning(f"Database fetch failed: {e}. Falling back to CSV.")
        return get_airport_code_list_csv(iata_or_icao, country)


def get_airport_code_list_db(iata_or_icao: str, country: str) -> List[str]:
    with DatabaseConnection(PG_URL) as conn:
        query = text(f"SELECT {iata_or_icao} FROM public.stg_airports WHERE country = :country")
        result = conn.execute(query, {"country": country})
        return [row[0] for row in result.fetchall()]


def get_airport_code_list_csv(iata_or_icao: str, country: str) -> List[str]:
    df = pd.read_csv(
        path.join(OUTPUT_DIR, INPUT_FILE_NAME),
        index_col='Airport_ID',
        encoding='utf-8'
    ).replace('"', '', regex=True)

    return df.loc[df['Country'] == country, iata_or_icao].tolist()


def scrap_flight_stats(airport_code: str, year: int, month: int, date: int, hour: int) -> List[Dict]:
    full_url = f"{BASE_WEBSITE}/{airport_code}/?year={year}&month={month}&date={date}&hour={hour}"
    logging.info(f"Fetching data for {airport_code} at hour {hour}: {full_url}")

    try:
        response = requests.get(full_url, headers=HTTP_HEADERS, timeout=10)
        response.raise_for_status()
    except requests.RequestException as e:
        logging.error(f"Failed to fetch data for {airport_code} hour {hour}: {e}")
        return []

    # Log snippet for debugging
    logging.debug(f"Response snippet: {response.text[:500]}")

    # Updated regex (ends with ; or <, handles Next.js changes)
    match = re.search(r'__NEXT_DATA__\s*=\s*(\{.*?\})\s*[;<]', response.text, re.DOTALL)
    if not match:
        logging.warning(f"No JSON data found for {airport_code} hour {hour} at {full_url}")
        return []

    try:
        json_data = json.loads(match.group(1))
    except json.JSONDecodeError as e:
        logging.error(f"JSON decode failed for {airport_code} hour {hour}: {e}")
        return []

    try:
        flight_tracker = json_data['props']['initialState']['flightTracker']
        flights = flight_tracker['route']['flights']

        for flight in flights:
            header = flight_tracker['route']['header']
            flight['date'] = header['date']
            flight['iata'] = header['arrivalAirport']['iata']
            flight['icao'] = header['arrivalAirport']['icao']
            flight['airport_name'] = header['arrivalAirport']['name']

        logging.info(f"{len(flights)} flights found for {airport_code} hour {hour}")
        return flights

    except KeyError as e:
        logging.error(f"Key missing in JSON for {airport_code} hour {hour}: {e}")
        return []


if __name__ == '__main__':
    main()
