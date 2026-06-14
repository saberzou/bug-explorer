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
    bugs = json.loads(BUGS_PATH.read_text())
    # Select only bugs that don't have a thumbnail yet (newly added)
    import sys
    public_bugs_dir = ROOT / "public" / "bugs"
    new_bugs = [b for b in bugs if not (public_bugs_dir / f"{b['slug']}.png").exists()]

    if not new_bugs:
        print("All bugs already have thumbnails.")
        return

    output = []
    for b in new_bugs:
        prompt = build_prompt(b["slug"], b["commonName"], b["latinName"])
        output.append({
            "slug": b["slug"],
            "commonName": b["commonName"],
            "latinName": b["latinName"],
            "prompt": prompt,
        })

    out_path = ROOT / "data" / "thumbnail_prompts.json"
    out_path.write_text(json.dumps(output, indent=2))
    print(f"Wrote {len(output)} prompts to {out_path.relative_to(ROOT)}")
    print(f"\nFirst prompt preview:")
    print(f"  slug: {output[0]['slug']}")
    print(f"  prompt: {output[0]['prompt'][:200]}...")


if __name__ == "__main__":
    main()
