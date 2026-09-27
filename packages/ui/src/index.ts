// Design tokens and physical-object components (F-08). Import "@kasa/ui/styles.css" once in the app.
export { tokens } from "./tokens";
export { clampRotation, tiltFor } from "./rotation";
export { LinedSheet, Note, noteVariant, Sticky, STICKY_MAX_CHARS } from "./components/note";
export { Polaroid } from "./components/polaroid";
export { IndexCard } from "./components/index-card";
export { DeletedOutline } from "./components/deleted";
export { PinMarker, Print, type Pin } from "./components/print";
export { BotButton, BotCard } from "./components/bot-card";
export { CategoryChip, CategoryStamp } from "./components/category";
export { Composer } from "./components/composer";
export { Avatar, AvatarStack, avatarColor, initialOf, type Person } from "./components/avatar";
export { Pile, type PileProps } from "./components/pile";
