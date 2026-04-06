const ballSpriteModules = import.meta.glob("../../../assets/theme1/balls/*.webp", {
  eager: true,
  import: "default",
});

const ballSpriteUrlsByNumber = Object.freeze(
  Object.entries(ballSpriteModules).reduce<Record<number, string>>((accumulator, [path, url]) => {
    const match = path.match(/\/(\d{2})_[^/]+\.webp$/);
    if (!match) {
      return accumulator;
    }

    const ballNumber = Number.parseInt(match[1], 10);
    if (Number.isFinite(ballNumber) && ballNumber > 0) {
      accumulator[ballNumber] = String(url);
    }

    return accumulator;
  }, {}),
);

export function getTheme1BallSpriteUrl(ballNumber: number): string | null {
  if (!Number.isFinite(ballNumber) || ballNumber <= 0) {
    return null;
  }

  return ballSpriteUrlsByNumber[ballNumber] ?? null;
}
