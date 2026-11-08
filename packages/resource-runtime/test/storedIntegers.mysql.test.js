import { storedIntegerCases } from "./support/storedIntegerCases.js";

// Non-id BIGINT columns read through a handle on MariaDB/MySQL.
storedIntegerCases("mysql");
