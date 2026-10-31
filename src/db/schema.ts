import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  real,
  index,
} from "drizzle-orm/pg-core";

export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  hostId: text("host_id").notNull(),
  status: text("status").notNull().default("lobby"), // lobby | playing | ended
  mapSeed: integer("map_seed").notNull(),
  maxPerTeam: integer("max_per_team").notNull().default(5),
  botsAlpha: integer("bots_alpha").notNull().default(4),
  botsBravo: integer("bots_bravo").notNull().default(4),
  tick: integer("tick").notNull().default(0),
  startedAt: timestamp("started_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const roomPlayers = pgTable(
  "room_players",
  {
    id: serial("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    playerId: text("player_id").notNull(),
    name: text("name").notNull(),
    team: text("team").notNull().default("alpha"), // alpha | bravo
    isHost: boolean("is_host").notNull().default(false),
    ready: boolean("ready").notNull().default(true),
    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    health: real("health").notNull().default(100),
    alive: boolean("alive").notNull().default(true),
    state: jsonb("state").$type<Record<string, unknown>>().default({}),
    lastSeen: timestamp("last_seen").notNull().defaultNow(),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (table) => [
    index("room_players_room_idx").on(table.roomCode),
    index("room_players_pid_idx").on(table.playerId),
  ],
);

export const matchEvents = pgTable(
  "match_events",
  {
    id: serial("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    type: text("type").notNull(), // hit | kill | chat | shot | loot | system
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("match_events_room_idx").on(table.roomCode, table.id)],
);
