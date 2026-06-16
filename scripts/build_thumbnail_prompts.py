#!/usr/bin/env python3
"""
Generate per-species prompts for the bug-explorer thumbnail set.

Style brief (locked from existing 30 thumbnails like atlas-moth, honey-bee, glasswing-butterfly):
- AI-illustrated, hand-drawn naturalist style (NOT photorealistic)
- Single bug, centered, hero composition
- Plain warm cream/beige background (#F5E6CC-ish)
- 1024x1024 square format, fits into circular thumbnail crop
- Subtle vintage-entomology-plate texture
- Anatomically accurate but illustrated, not stiff
- Natural lighting, slight drop shadow under bug

Per-bug prompt = STYLE_HEADER + species anatomy + species color + STYLE_FOOTER.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUGS_PATH = ROOT / "data" / "bugs.json"

# Anatomy notes per slug: bug-specific shape and color details to weave into the prompt
ANATOMY = {
    "giant-water-bug": "flattened oval body, large raptorial front legs, paddle-like swimming hind legs, short antennae, dark olive-brown body with paler underside",
    "eastern-dobsonfly": "long slender brown body with lacy translucent wings folded over the back, oversized curved tusk-like mandibles extending forward, six thin legs, soft brown and amber palette",
    "water-strider": "elongated narrow body, four very long thin legs splayed on the water, two shorter front legs held forward, dark brown body, hair-fringed legs visible",
    "mayfly": "delicate translucent body, three long thread-like tails, large upright wings held vertically, pale cream and amber colors, fragile insect appearance",
    "diving-beetle": "smooth oval streamlined body, dark olive-green with yellow trim around the edges, paddle-like hind legs with fringes of swimming hairs",
    "fairyfly": "microscopic insect rendered as if highly magnified, tiny pear-shaped body with feathery hair-fringed wings, antennae longer than body, pale translucent appearance",
    "springtail": "tiny soft-bodied insect, short antennae, six legs, dark slate-blue with metallic sheen, plump segmented body with the forked tail spring visible underneath",
    "brazilian-treehopper": "small insect with absurdly elaborate crown of black hairy spheres on a stalk above its head, body itself brown and small, the helmet structure dominates the silhouette",
    "mantis-lacewing": "praying-mantis-like front legs raised, but with delicate transparent lacewing wings folded over a slender body, pale greenish-tan coloring, mantis posture is the giveaway",
    "mole-cricket": "stocky cricket with massive flattened shovel-like front legs adapted for digging, sandy brown body with velvety texture, large head, short wings",
    "antlion": "delicate slender adult lacewing-like insect with very long transparent wings and a thin elongated abdomen, pale gray-brown body, gentle elegant posture",
    "common-glow-worm": "wingless larva-shaped female beetle with segmented brown body, last three abdominal segments glowing soft yellow-green, vintage-illustration treatment of bioluminescence",
    "new-zealand-glowworm": "fungus gnat larva inside a translucent silk tube with hanging beaded threads, body glowing soft blue-green, cave-ceiling context implied by darkness around the bug only",
    "lantern-bug": "planthopper with a hugely elongated peanut-shaped hollow snout extending forward like a unicorn horn, body brightly colored with red, yellow, and green wing patterns",
    "giraffe-weevil": "small beetle with a comically long red-orange neck multiple times the length of its body, glossy black body with bright red elytra, weevil-style snout",
    "harlequin-beetle": "long-horn beetle with absurdly elongated front legs longer than its body, body patterned with black, tan, and red zigzag harlequin markings, long antennae",
    "frog-legged-leaf-beetle": "small beetle with enormously enlarged muscular frog-like hind legs, body iridescent rainbow metallic with shifting green-gold-magenta highlights",
    "comet-moth": "large saturniid moth with brilliant gold and crimson wings and two extremely long ribbon-like tail streamers trailing 15cm below the hindwings, hairy white body",
    "leafcutter-ant": "medium ant carrying a green leaf fragment many times its size above its head, reddish-brown body, spiny thorax, long jointed legs",
    "weaver-ant": "slender ant in dynamic posture, glossy reddish-orange body, long legs, holding silk-spinning larva in mandibles",
    "honeypot-ant": "ant with its abdomen swollen into a translucent amber sphere full of nectar, swollen abdomen is the dominant feature, thorax and head proportionally tiny",
    "bullet-ant": "large solid black ant with reddish-brown reddish-brown legs, prominent stinger curved at the abdomen tip, powerful jaws, threatening confident posture",
    "termite-queen": "enormously distended sausage-shaped pale white abdomen with faint segmentation lines, tiny head and thorax at one end with small workers attending, focus on the gigantic immobile queen body",
    "titan-beetle": "massive longhorn beetle with rich chocolate-brown elytra, enormous strong mandibles, thick antennae longer than the body, hulking proportions",
    "lubber-grasshopper": "stocky heavy-bodied grasshopper, vivid yellow and orange body with black markings, short stubby useless wings, bright warning coloration",
    "vampire-moth": "medium brown moth at rest with wings spread, mottled bark-colored cryptic wing pattern, long curved proboscis extended downward, body slightly hairy",
    "asian-giant-hornet": "massive hornet with orange head, large black eyes, alternating black-and-orange striped abdomen, prominent stinger, threatening size and posture",
    "picture-winged-fly": "small fly with transparent wings marked with bold black patterns resembling spider-leg silhouettes, slender body, dark thorax",
    "sunset-moth": "diurnal moth with iridescent rainbow wings showing bands of blue, green, gold, magenta, and crimson, long tails on hindwings, looks more like a butterfly",
    "bee-fly": "fluffy round bumblebee-mimicking fly, golden-orange and black fuzzy body, very long needle-like proboscis extending forward, large clear wings, hovering posture",
    "blue-morpho": "large butterfly with wings spread flat, upper wing surfaces brilliant iridescent metallic electric blue with thin black borders, slender dark body, antennae like fine clubbed wires, wings catch light with structural shimmer",
    "queen-alexandras-birdwing": "enormous butterfly with wings spread flat, broad rounded forewings velvet black with cream and golden-yellow zigzag bands, hindwings rich green with gold central patches, plump cream-yellow body, the wingspan dominates the frame",
    "goliath-birdwing": "large male butterfly with wings spread flat, deep velvet black wings with brilliant neon yellow-green wedge patches on hindwings and forewing centers, golden-yellow body, broad muscular thorax",
    "apollo-butterfly": "medium butterfly with wings spread flat, translucent porcelain-white wings with smoky-gray veining, four prominent crimson-red eyespots ringed in black on the hindwings, white fluffy body, alpine elegance",
    "sylphina-angel": "small delicate butterfly with wings spread flat, forewings nearly transparent crystal-clear with dark veins, hindwings carry two slim ribbon-like crimson tail streamers trailing below, tiny dark body, ethereal almost weightless appearance",
    # --- legacy backlog: re-generated under the circular safe-zone footer ---
    "hercules-beetle": "large rhinoceros beetle, glossy olive-yellow elytra flecked with black, two enormous curved horns forming a pincer (one curving down from the thorax, one up from the head), robust black legs, the long horn is the dominant feature but posed to stay within the circle",
    "glasswing-butterfly": "butterfly with wings spread, wing membranes almost completely transparent like clear glass with opaque dark brown borders edged in faint orange, slender dark body, the see-through panes are the defining feature",
    "european-hornet": "large social wasp, reddish-brown head and thorax, yellow abdomen marked with brown teardrop bands, two pairs of amber wings folded along the body, long legs, robust build",
    "rosy-maple-moth": "small fluffy saturniid moth at rest with wings spread, candy coloring of bright pink wing margins and creamy lemon-yellow bands, woolly yellow body, feathery antennae, fuzzy legs, wings posed compactly",
    "orchid-mantis": "praying mantis mimicking a flower, white blushed with pink, flattened lobed petal-like legs, raised spiny forelegs, triangular head, delicate blossom appearance, limbs gathered inward",
    "giant-prickly-stick-insect": "bulky thorny stick insect, body and legs studded with spines, curled abdomen held scorpion-like over the back, mottled brown camouflage, heavy-bodied, coiled compactly rather than splayed",
    "jewel-caterpillar": "translucent gelatinous caterpillar covered in glassy gel-like spiky tubercles, faint orange-yellow body glowing through the clear spines, looks like a living cluster of gummy beads",
    "picasso-bug": "shield bug with a rounded domed back brightly patterned with concentric rings and dots in green, orange, black and cream like abstract art, small head, six short legs tucked in",
    "stalk-eyed-fly": "small slender fly whose eyes sit on the ends of two long thin horizontal eyestalks spreading sideways from the head, dark narrow body, clear wings; pose the eyestalks angled slightly so the whole span stays inside the circle",
    "spiny-flower-mantis": "small mantis, white-and-green body with a bold swirl eyespot on each forewing, spiny thorax and legs, raised raptorial forelegs, flower-mimic posture, limbs drawn inward",
    "monarch-butterfly": "butterfly with wings spread flat, bright orange wings veined and bordered in black with rows of white dots along the margins, slender black body, classic showy pattern, wingtips kept clear of the edge",
    "european-mantis": "praying mantis, slender green body, elongated thorax, triangular head with large eyes, raised spiny raptorial forelegs, a bullseye spot on the inner foreleg, posture compact",
    "periodical-cicada": "stout cicada, black body with vivid red-orange eyes, translucent wings with orange veins held roof-like over the body, six orange legs",
    "bombardier-beetle": "ground beetle with blue-black iridescent elytra and a reddish-orange head, thorax and legs, oval body, long antennae, all limbs and antennae curved inward",
    "cuckoo-wasp": "small jewel-like wasp with a brilliant metallic emerald-green and sapphire-blue body and a coarsely pitted surface, short wings, compact rounded abdomen, legs tucked beneath",
    "helicopter-damselfly": "very large slender damselfly with an extremely long thin dark blue-black abdomen gently curved into a relaxed C so it never reaches the edge, four narrow clear wings each tipped with a bold band of white and metallic blue, the two wing pairs swept and angled inward rather than fully outstretched, large widely-set eyes, delicate thread-like legs folded compactly beneath the thorax; pose the whole insect coiled and breathing-room-padded so wings, wingtip bands, and the long tail all sit well inside the circle",
    "corpse-carrying-assassin-bug": "small reddish-brown assassin bug nymph almost entirely hidden beneath a wobbling teetering backpack made of the dried hollow husks and carcasses of dead ants it has killed, the ragged dark cluster of stacked ant bodies forming a shaggy mound on its back is the dominant silhouette, only the assassin bug's beady head, short curved piercing beak, and a few slender jointed legs peek out from underneath, legs and short antennae curled inward and tucked close to the body, warm earthy brown and black palette, the whole macabre bundle posed compactly and centered with even breathing room so the corpse-pile, legs, and antennae all stay well inside the circle",
    "golden-tortoise-beetle": "a tiny rounded oval beetle shaped like a domed shield or miniature tortoise, its translucent glass-like outer shell flaring outward in a clear rim beyond the body edge, the central dome glowing a brilliant mirror-bright metallic gold fading toward warm amber and a hint of brick-red at the rim, six short legs and a small head almost fully tucked beneath the broad transparent shell, short antennae curled inward, the see-through golden carapace is the defining feature, compact domed silhouette posed centered with even breathing room so the whole rounded shell and tucked legs sit well inside the circle",
}

STYLE_HEADER = "A hand-drawn naturalist scientific illustration of a"
STYLE_FOOTER = (
    "Vintage entomology field guide aesthetic with subtle ink and watercolor texture, "
    "warm earthy palette, single bug centered as hero on a plain warm cream/beige background "
    "(no scene, no environment), soft even lighting, gentle drop shadow beneath the bug, "
    "square 1:1 composition. "
    "CIRCULAR SAFE ZONE: the final image is cropped to a CIRCLE, so the ENTIRE insect — "
    "including every leg, antenna, wing, and tail streamer, plus its drop shadow — must sit "
    "fully inside the central inscribed circle with even breathing room on all sides. The bug "
    "occupies roughly 60-68 percent of the frame, comfortably centered; nothing touches or "
    "extends toward the edges or the four corners. Long appendages (antennae, legs, moth tails) "
    "are posed inward/curved so they stay within the circle rather than reaching the border. "
    "illustrated style not photorealistic, designed to be displayed as a circular thumbnail. "
    "ABSOLUTELY NO TEXT, NO LABELS, NO CAPTIONS, NO SPECIES NAMES, NO TAXONOMIC ANNOTATIONS, "
    "NO LATIN BINOMIAL, NO TYPOGRAPHY OF ANY KIND ANYWHERE IN THE IMAGE, NO SCALE BAR. "
    "The cream/beige background must be a SQUARE solid fill that completely covers the entire "
    "image edge to edge — NOT a circular or oval parchment vignette. The background fills all "
    "four corners. Pure illustration only, no field-guide caption block, no specimen-card framing, "
    "no decorative border, no parchment cutout shape."
)


def build_prompt(slug: str, common: str, latin: str) -> str:
    anatomy = ANATOMY.get(slug)
    if not anatomy:
        raise KeyError(f"no anatomy for {slug}")
    return f"{STYLE_HEADER} {common} ({latin}). {anatomy}. {STYLE_FOOTER}"


def main():
    import argparse
    import sys

    ap = argparse.ArgumentParser(
        description="Emit per-species thumbnail generation prompts."
    )
    ap.add_argument(
        "slugs", nargs="*",
        help="explicit slugs to (re)generate prompts for, even if a PNG already "
             "exists (e.g. backlog re-gen). Default: bugs with no PNG yet.",
    )
    args = ap.parse_args()

    bugs = json.loads(BUGS_PATH.read_text())
    by_slug = {b["slug"]: b for b in bugs}
    public_bugs_dir = ROOT / "public" / "bugs"

    if args.slugs:
        # Explicit regen list: take the given slugs regardless of existing PNG.
        unknown = [s for s in args.slugs if s not in by_slug]
        if unknown:
            sys.exit(f"unknown slug(s) not in bugs.json: {unknown}")
        targets = [by_slug[s] for s in args.slugs]
    else:
        # Default: only bugs that don't have a thumbnail yet (newly added).
        targets = [b for b in bugs
                   if not (public_bugs_dir / f"{b['slug']}.png").exists()]

    if not targets:
        print("Nothing to do — all selected bugs already have thumbnails.")
        return

    output = []
    missing_anatomy = []
    for b in targets:
        try:
            prompt = build_prompt(b["slug"], b["commonName"], b["latinName"])
        except KeyError:
            missing_anatomy.append(b["slug"])
            continue
        output.append({
            "slug": b["slug"],
            "commonName": b["commonName"],
            "latinName": b["latinName"],
            "prompt": prompt,
        })

    if missing_anatomy:
        sys.exit(
            "no ANATOMY entry for: " + ", ".join(missing_anatomy)
            + "\nAdd descriptions to the ANATOMY dict before generating."
        )

    out_path = ROOT / "data" / "thumbnail_prompts.json"
    out_path.write_text(json.dumps(output, indent=2))
    print(f"Wrote {len(output)} prompts to {out_path.relative_to(ROOT)}")
    print(f"\nFirst prompt preview:")
    print(f"  slug: {output[0]['slug']}")
    print(f"  prompt: {output[0]['prompt'][:200]}...")


if __name__ == "__main__":
    main()
