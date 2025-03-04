import { TruthyQueryParam } from '../types/schemas.ts';
import { isNonEmptyString, parseIntOrNull } from './index.ts';

export const DATABASE_LOCATION_ENV_VAR = 'TUNARR_DATABASE_PATH';
export const SERVER_PORT_ENV_VAR = 'TUNARR_SERVER_PORT';
export const ADMIN_MODE_ENV_VAR = 'TUNARR_SERVER_ADMIN_MODE';
export const PRINT_ROUTES_ENV_VAR = 'TUNARR_SERVER_PRINT_ROUTES';
export const BIND_ADDR_ENV_VAR = 'TUNARR_BIND_ADDR';
export const BUILD_ENV_VAR = 'TUNARR_BUILD';
export const IS_EDGE_BUILD_ENV_VAR = 'TUNARR_EDGE_BUILD';
export const SEARCH_PORT = 'TUNARR_SEARCH_PORT';
export const SEARCH_MAX_RAM = 'TUNARR_SEARCH_MAX_MEMORY';

// Debug vars
export const DEBUG__PROGRAM_GROUPING_UPDATE_CHUNK_SIZE =
  'TUNARR_DEBUG_PROGRAM_GROUP_CHUNK_SIZE';
export const DEBUG__REDUCE_SEARCH_INDEXING_MEMORY =
  'TUNARR_DEBUG_REDUCE_SEARCH_INDEXING_MEMORY';

export const TUNARR_ENV_VARS = {
  DATABASE_LOCATION_ENV_VAR,
  SERVER_PORT_ENV_VAR,
  ADMIN_MODE_ENV_VAR,
  PRINT_ROUTES_ENV_VAR,
  BIND_ADDR_ENV_VAR,
  BUILD_ENV_VAR,
  IS_EDGE_BUILD_ENV_VAR,
  SEARCH_PORT,
  SEARCH_MAX_RAM,
  DEBUG__PROGRAM_GROUPING_UPDATE_CHUNK_SIZE,
  DEBUG__REDUCE_SEARCH_INDEXING_MEMORY,
} as const;

export function getEnvVar(name: string) {
  const val = process.env[name];
  return isNonEmptyString(val) ? val : null;
}

export const getNumericEnvVar = (name: string) => {
  const val = getEnvVar(name);
  return val ? parseIntOrNull(val) : null;
};

export const getBooleanEnvVar = (
  name: string,
  defaultValue: boolean = true,
) => {
  const val = getEnvVar(name);
  if (val) {
    return TruthyQueryParam.catch(defaultValue).parse(process.env[name]);
  }
  return defaultValue;
};
