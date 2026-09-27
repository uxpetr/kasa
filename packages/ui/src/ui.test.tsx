import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { render } from "../scripts/generate-tokens";
import { avatarColor, AvatarStack, BotButton, BotCard, CategoryChip, CategoryStamp, clampRotation, Composer, DeletedOutline, IndexCard, initialOf, Note, noteVariant, Pile, Polaroid, Print, tiltFor, tokens } from "./index";

describe("tokens", () => {
  it("match design/tokens.json (run `pnpm --filter @kasa/ui tokens` if this fails)", () => {
    const { ts, css } = render();
    expect(readFileSync(new URL("./tokens.ts", import.meta.url), "utf8")).toBe(ts);
    expect(readFileSync(new URL("./tokens.css", import.meta.url), "utf8")).toBe(css);
  });

  // WCAG 2 relative luminance and contrast ratio.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const c = tokens.color;

  it.each<[string, string, string]>([
    ["ink on table", c.ink, c.table],
    ["body ink on table", c.inkBody, c.table],
    ["muted ink on table", c.inkMuted, c.table],
    ["muted ink on the alt table", c.inkMuted, c.tableAlt],
    ["ink on sticky", c.ink, c.sticky],
    ["ink on bot paper", c.ink, c.botPaper],
    ["stamp text on stamp", c.botStampText, c.botStampBg],
    ["white on accent (Send)", "#FFFFFF", c.accent],
    ["white on pine (bot button)", "#FFFFFF", c.bot],
    ["white on ink (pressed chip)", "#FFFFFF", c.ink],
    ["white on muted ink (+N avatar)", "#FFFFFF", c.inkMuted],
    ...tokens.avatar.map((bg): [string, string, string] => [`white on avatar ${bg}`, "#FFFFFF", bg]),
  ])("%s has at least 4.5:1 contrast", (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("rotation", () => {
  it("clamps to the token limit", () => {
    expect(tokens.motion.maxRotationDeg).toBe(2.5);
    expect(clampRotation(5)).toBe(2.5);
    expect(clampRotation(-4)).toBe(-2.5);
    expect(clampRotation(1.2)).toBe(1.2);
    expect(clampRotation(Number.NaN)).toBe(0);
  });

  it("gives each id a stable tilt within the limit", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `entry-${i}`);
    for (const id of ids) {
      expect(tiltFor(id)).toBe(tiltFor(id));
      expect(Math.abs(tiltFor(id))).toBeLessThan(2.5);
    }
    expect(new Set(ids.map(tiltFor)).size).toBeGreaterThan(10);
  });

  it("is applied clamped on rendered objects", () => {
    expect(renderToStaticMarkup(<Note text="hi" rotate={9} />)).toContain("--kasa-rotate:2.5deg");
  });
});

describe("Note", () => {
  it("uses a sticky for short text and a lined sheet for long text", () => {
    expect(noteVariant("Last night in Kyoto: somewhere with an onsen?")).toBe("sticky");
    expect(noteVariant("x".repeat(141))).toBe("lined");
    expect(noteVariant("a\nb\nc\nd\ne")).toBe("lined");
    expect(renderToStaticMarkup(<Note text="short" />)).toContain("kasa-sticky");
    expect(renderToStaticMarkup(<Note text={"long ".repeat(40)} />)).toContain("kasa-lined");
  });

  it("escapes text instead of rendering it as HTML", () => {
    expect(renderToStaticMarkup(<Note text="<img src=x onerror=alert(1)>" />)).not.toContain("<img");
  });
});

describe("accessible markup", () => {
  it("polaroids keep alt text and label the stack count", () => {
    const html = renderToStaticMarkup(<Polaroid src="/a.jpg" alt="Kinkaku-ji" caption="Pond at 8am" moreCount={4} />);
    expect(html).toContain('alt="Kinkaku-ji"');
    expect(html).toContain('aria-label="4 more photos"');
  });

  it("interactive pins are labelled buttons that report their open state", () => {
    const html = renderToStaticMarkup(
      <Print src="/p.jpg" alt="Tokyo Tower" pins={[{ number: 1, x: 0.4, y: 0.3 }, { number: 2, x: 0.7, y: 0.2 }]} openPin={1} onSelectPin={() => {}} />,
    );
    expect(html).toContain('aria-label="Pin 1"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("static pins are hidden from screen readers", () => {
    const html = renderToStaticMarkup(<Print src="/p.jpg" alt="Tokyo Tower" pins={[{ number: 1, x: 0.4, y: 0.3 }]} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<button");
  });

  it("the bot card is labelled as the bot and its buttons are real buttons", () => {
    const html = renderToStaticMarkup(
      <BotCard actions={<BotButton>Yes, suggest</BotButton>}>Split them across days?</BotCard>,
    );
    expect(html).toContain('aria-label="Kasa Bot"');
    expect(html).toMatch(/<button type="button"[^>]*>Yes, suggest<\/button>/);
  });

  it("chips expose their pressed state", () => {
    expect(renderToStaticMarkup(<CategoryChip label="Sights" count={3} pressed onToggle={() => {}} />)).toContain('aria-pressed="true"');
    expect(renderToStaticMarkup(<CategoryStamp>Plans</CategoryStamp>)).toContain("kasa-stamp");
  });

  it("the composer input has a label", () => {
    const html = renderToStaticMarkup(<Composer label="Add to Japan 2027" value="" onChange={() => {}} onSubmit={() => {}} onAttach={() => {}} />);
    const id = html.match(/<input id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain("Add to Japan 2027");
    expect(html).toContain('aria-label="Attach an image or file"');
  });
});

describe("avatars", () => {
  it("use the first letter of the name", () => {
    expect(initialOf("mika tanaka")).toBe("M");
    expect(initialOf("  Émile")).toBe("É");
    expect(initialOf("🙂 Jo")).toBe("J");
    expect(initialOf("")).toBe("?");
  });

  it("give each person a stable palette colour", () => {
    expect(avatarColor("user-1")).toBe(avatarColor("user-1"));
    expect(tokens.avatar).toContain(avatarColor("user-2"));
  });

  it("collapse members past the limit into +N and name everyone for screen readers", () => {
    const people = ["Aiko", "Mika", "Jun", "Petr", "Sara", "Lena", "Rui"].map((name, i) => ({ id: `u${i}`, name }));
    const html = renderToStaticMarkup(<AvatarStack people={people} max={4} label="7 members" />);
    expect(html).toContain("+3");
    expect(html).toContain('aria-label="7 members"');
    expect(html.match(/class="kasa-avatar"/g)).toHaveLength(4);
  });
});

describe("Pile", () => {
  const members = [
    { id: "a", name: "Aiko" },
    { id: "m", name: "Mika" },
  ];

  it("draws a stack of paper with title, unread badge, preview, and members", () => {
    const html = renderToStaticMarkup(
      <Pile id="p1" href="/projects/p1" title="Japan 2027" preview="Mika: Yes!" unread={3} members={members} meta="Yesterday" />,
    );
    expect(html.match(/kasa-pile-sheet/g)).toHaveLength(2);
    expect(html).toContain('href="/projects/p1"');
    expect(html).toContain("3 new");
    expect(html).toContain("Mika: Yes!");
    expect(html).toContain("Yesterday");
    expect(html).toContain("2 members: Aiko, Mika");
  });

  it("shows no badge without unread entries", () => {
    expect(renderToStaticMarkup(<Pile id="p1" href="#" title="T" members={members} />)).not.toContain(" new<");
  });

  it("draws a one-member project as a sticky without sheets or avatars", () => {
    const html = renderToStaticMarkup(<Pile id="p1" href="#" title="My pile" members={[members[0]!]} personal />);
    expect(html).toContain("data-personal");
    expect(html).not.toContain("kasa-pile-sheet");
    expect(html).not.toContain("kasa-avatar");
  });

  it("lets a peeking photo replace the time and keeps every tilt under the limit", () => {
    const html = renderToStaticMarkup(
      <Pile id="p1" href="#" title="T" members={members} meta="Mon" peek={{ src: "/x.jpg", alt: "A street" }} />,
    );
    expect(html).toContain('alt="A street"');
    expect(html).not.toContain("Mon");
    for (const [, deg] of html.matchAll(/rotate\((-?[\d.]+)deg\)/g)) {
      expect(Math.abs(Number(deg))).toBeLessThanOrEqual(tokens.motion.maxRotationDeg);
    }
  });
});

describe("BotCard in the feed", () => {
  it("drops its own header when the feed already shows the k mark and name", () => {
    expect(renderToStaticMarkup(<BotCard>Hi</BotCard>)).toContain("kasa-bot-header");
    expect(renderToStaticMarkup(<BotCard header={false}>Hi</BotCard>)).not.toContain("kasa-bot-header");
  });
});

describe("P-04 objects", () => {
  it("fans several photos into a stack with a count, and opens full size from a button", () => {
    const single = renderToStaticMarkup(<Polaroid src="/a.jpg" alt="Kyoto" onOpen={() => {}} />);
    expect(single).not.toContain("kasa-photo-stack");
    expect(single).toContain('aria-label="Open photo"');
    const stack = renderToStaticMarkup(<Polaroid src="/a.jpg" alt="Kyoto" moreCount={3} />);
    expect(stack).toContain("kasa-photo-stack");
    expect(stack.match(/kasa-stack-sheet/g)).toHaveLength(2);
    expect(stack).toContain('aria-label="3 more photos"');
    expect(renderToStaticMarkup(<Polaroid src="/a.jpg" alt="Kyoto" moreCount={1} />).match(/kasa-stack-sheet/g)).toHaveLength(1);
  });

  it("makes an index card a single safe link", () => {
    const html = renderToStaticMarkup(<IndexCard href="https://example.com/a" label="Link · example.com" title="How to use a JR Pass" />);
    expect(html).toMatch(/^<a [^>]*href="https:\/\/example.com\/a"/);
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).not.toContain("<img");
  });

  it("leaves a dashed outline for deleted objects", () => {
    expect(renderToStaticMarkup(<DeletedOutline text="Mika deleted a note" />)).toContain('class="kasa-deleted"');
  });
});
