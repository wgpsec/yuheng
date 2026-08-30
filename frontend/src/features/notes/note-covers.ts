export type BuiltInNoteCover = { id: string; label: string; background: string; image?: string };

export const BUILT_IN_NOTE_COVERS: readonly BuiltInNoteCover[] = [
  { id: 'aurora', label: '极光', background: 'linear-gradient(120deg, #173b4f 0%, #397f78 48%, #b7c98d 100%)', image: new URL('../../assets/note-covers/forest.webp', import.meta.url).href },
  { id: 'dawn', label: '晨曦', background: 'linear-gradient(120deg, #56354a 0%, #c57b63 45%, #f0cf9f 100%)', image: new URL('../../assets/note-covers/mountain-dawn.webp', import.meta.url).href },
  { id: 'forest', label: '林野', background: 'linear-gradient(120deg, #1d352f 0%, #48745c 50%, #b0bb7a 100%)', image: new URL('../../assets/note-covers/forest.webp', import.meta.url).href },
  { id: 'ocean', label: '海岸', background: 'linear-gradient(120deg, #18324a 0%, #2f6d8b 52%, #a9d2cf 100%)', image: new URL('../../assets/note-covers/coastline.webp', import.meta.url).href },
  { id: 'ink', label: '墨色', background: 'linear-gradient(120deg, #20232a 0%, #4d5968 48%, #c2b8a3 100%)', image: new URL('../../assets/note-covers/ink-abstract.webp', import.meta.url).href },
  { id: 'lavender', label: '暮紫', background: 'linear-gradient(120deg, #34294f 0%, #75649c 50%, #d7bfdc 100%)', image: new URL('../../assets/note-covers/ink-abstract.webp', import.meta.url).href },
  { id: 'sand', label: '砂岩', background: 'linear-gradient(120deg, #6a4937 0%, #b7835d 50%, #e4c79e 100%)', image: new URL('../../assets/note-covers/paper-texture.webp', import.meta.url).href },
  { id: 'mist', label: '薄雾', background: 'linear-gradient(120deg, #45545b 0%, #91a9aa 50%, #e0e1d6 100%)', image: new URL('../../assets/note-covers/paper-texture.webp', import.meta.url).href },
  { id: 'city', label: '城市', background: 'linear-gradient(120deg, #20283e 0%, #6d728b 50%, #d3b6a4 100%)', image: new URL('../../assets/note-covers/city.webp', import.meta.url).href },
];

export function builtInNoteCover(id: string | null | undefined): BuiltInNoteCover | null {
  return BUILT_IN_NOTE_COVERS.find((cover) => cover.id === id) ?? null;
}

export function randomNoteCover(exclude?: string | null, random: () => number = Math.random): BuiltInNoteCover {
  const candidates = BUILT_IN_NOTE_COVERS.filter((cover) => cover.id !== exclude);
  return candidates[Math.floor(Math.max(0, Math.min(0.999999, random())) * candidates.length)] ?? BUILT_IN_NOTE_COVERS[0];
}
