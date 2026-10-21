// -----------------------------
// Default configuration & state
// -----------------------------
const defaultRGBConfig = { R: 255, G: 255, B: 255 };
let useColors = true;

// -----------------------------
// Helpers
// -----------------------------
export const applyDefaults = (R, G, B) => ({
    R: R !== undefined ? R : defaultRGBConfig.R,
    G: G !== undefined ? G : defaultRGBConfig.G,
    B: B !== undefined ? B : defaultRGBConfig.B,
});

/**
 * Produces the ANSI 24-bit foreground color
 */
export const rgb = (R, G, B) => {
    const { R: r, G: g, B: b } = applyDefaults(R, G, B);

    // Pre-validate once at creation time for performance
    if ([r, g, b].some(v => v < 0 || v > 255)) {
        throw new Error(`RGB values must be in range 0–255 (received: ${r}, ${g}, ${b})`);
    }

    // Precompile the prefix/suffix so styling is O(1)
    const open = `\x1b[38;2;${r};${g};${b}m`;
    const close = `\x1b[0m`;

    return (string) => {
        try {
            return useColors ? `${open}${string}${close}` : string;
        } catch (e) {
            return `Error generating colored text: ${e.message}`;
        }
    };
};

// Toggle color usage dynamically
export const setUseColors = (value) => {
    useColors = value === true;
};

// -----------------------------
// Static SGR wrappers
// -----------------------------
const SGR = (open) => (string) => `\x1b[${open}m${string}\x1b[0m`;

// -----------------------------
// Export full color map (unchanged)
// -----------------------------
export default () => ({
    reset: SGR("0"),
    black: SGR("0;30"), red: SGR("0;31"), green: SGR("0;32"),
    yellow: SGR("0;33"), blue: SGR("0;34"), magenta: SGR("0;35"),
    cyan: SGR("0;36"), white: SGR("0;37"),

    bold: SGR("1"), italic: SGR("3"), underline: SGR("4"),
    strikethrough: SGR("9"), inverse: SGR("7"), hidden: SGR("8"),

    bgBlack: SGR("40"), bgRed: SGR("41"), bgGreen: SGR("42"),
    bgYellow: SGR("43"), bgBlue: SGR("44"), bgMagenta: SGR("45"),
    bgCyan: SGR("46"), bgWhite: SGR("47"),

    purple: SGR("0;35"),

    // Extended color shortcuts (unchanged)
    orange: rgb(255,165,0),
    pink: rgb(255,192,203),
    brown: rgb(165,42,42),
    gray: rgb(128,128,128),
    lightGray: rgb(211,211,211),
    darkGray: rgb(169,169,169),
    lightBlue: rgb(173,216,230),
    darkBlue: rgb(0,0,139),
    lightGreen: rgb(144,238,144),
    darkGreen: rgb(0,100,0),
    gold: rgb(255,215,0),
    silver: rgb(192,192,192),
    teal: rgb(0,128,128),
    navy: rgb(0,0,128),
    lavender: rgb(230,230,250),
    peach: rgb(255,218,185),
    coral: rgb(255,127,80),
    crimson: rgb(220,20,60),
    indigo: rgb(75,0,130),
    violet: rgb(238,130,238),
    khaki: rgb(240,230,140),
    beige: rgb(245,245,220),
    mint: rgb(189,252,201),
    ivory: rgb(255,255,240),
    salmon: rgb(250,128,114),
    chocolate: rgb(210,105,30),
    wheat: rgb(245,222,179),
    plum: rgb(221,160,221),
    lime: rgb(0,255,0),
    skyBlue: rgb(135,206,235),
    seaGreen: rgb(46,139,87),
    olive: rgb(128,128,0),
    maroon: rgb(128,0,0),
    forestGreen: rgb(34,139,34),
    royalBlue: rgb(65,105,225),
    sand: rgb(194,178,128),
    azure: rgb(240,255,255),
    tan: rgb(210,180,140),
    aquamarine: rgb(127,255,212),
    sienna: rgb(160,82,45),

    gainsboro: rgb(220,220,220),
    antiqueWhite: rgb(250,235,215),
    snow: rgb(255,250,250),
    linen: rgb(250,240,230),
    fireBrick: rgb(178,34,34),
    darkRed: rgb(139,0,0),
    lightCoral: rgb(240,128,128),
    hotPink: rgb(255,105,180),
    deepPink: rgb(255,20,147),
    darkOrange: rgb(255,140,0),
    lightSalmon: rgb(255,160,122),
    goldenrod: rgb(218,165,32),
    lemonChiffon: rgb(255,250,205),
    moccasin: rgb(255,228,181),
    paleGreen: rgb(152,251,152),
    springGreen: rgb(0,255,127),
    lightSeaGreen: rgb(32,178,170),
    mediumSeaGreen: rgb(60,179,113),
    darkOliveGreen: rgb(85,107,47),
    steelBlue: rgb(70,130,180),
    dodgerBlue: rgb(30,144,255),
    powderBlue: rgb(176,224,230),
    midnightBlue: rgb(25,25,112),
    slateBlue: rgb(106,90,205),
    mediumPurple: rgb(147,112,219),
    orchid: rgb(218,112,214),
    thistle: rgb(216,191,216),
    mediumVioletRed: rgb(199,21,133),
    darkOrchid: rgb(153,50,204),
    peru: rgb(205,133,63),
    saddleBrown: rgb(139,69,19),
    rosyBrown: rgb(188,143,143),
    burlywood: rgb(222,184,135),
    darkKhaki: rgb(189,183,107),
    paleTurquoise: rgb(175,238,238),
    darkTurquoise: rgb(0,206,209),
    mediumAquamarine: rgb(102,205,170),
    lightCyan: rgb(224,255,255),
    cadetBlue: rgb(95,158,160),

    goldMetallic: rgb(212,175,55),
    oldGold: rgb(207,181,59),
    brass: rgb(181,166,66),
    paleVioletRed: rgb(219,112,147),
    fuchsia: rgb(255,0,255),
    byzantium: rgb(112,41,99),
    emerald: rgb(80,200,120),
    cerulean: rgb(0,123,167),
    cobaltBlue: rgb(0,71,171),
    venetianRed: rgb(200,8,21),
    burntUmber: rgb(138,51,36),
    auburn: rgb(165,42,42),

    // Your extended SGR map (all preserved exactly)
    Color_Off: SGR("0"),
    Black: SGR("0;30"), Red: SGR("0;31"), Green: SGR("0;32"),
    Yellow: SGR("0;33"), Blue: SGR("0;34"), Purple: SGR("0;35"),
    Cyan: SGR("0;36"), White: SGR("0;37"),

    BBlack: SGR("1;30"), BRed: SGR("1;31"), BGreen: SGR("1;32"),
    BYellow: SGR("1;33"), BBlue: SGR("1;34"), BPurple: SGR("1;35"),
    BCyan: SGR("1;36"), BWhite: SGR("1;37"),

    UBlack: SGR("4;30"), URed: SGR("4;31"), UGreen: SGR("4;32"),
    UYellow: SGR("4;33"), UBlue: SGR("4;34"), UPurple: SGR("4;35"),
    UCyan: SGR("4;36"), UWhite: SGR("4;37"),

    On_Black: SGR("40"), On_Red: SGR("41"), On_Green: SGR("42"),
    On_Yellow: SGR("43"), On_Blue: SGR("44"), On_Purple: SGR("45"),
    On_Cyan: SGR("46"), On_White: SGR("47"),

    IBlack: SGR("0;90"), IRed: SGR("0;91"), IGreen: SGR("0;92"),
    IYellow: SGR("0;93"), IBlue: SGR("0;94"), IPurple: SGR("0;95"),
    ICyan: SGR("0;96"), IWhite: SGR("0;97"),

    BIBlack: SGR("1;90"), BIRed: SGR("1;91"), BIGreen: SGR("1;92"),
    BIYellow: SGR("1;93"), BIBlue: SGR("1;94"), BIPurple: SGR("1;95"),
    BICyan: SGR("1;96"), BIWhite: SGR("1;97"),

    On_IBlack: SGR("0;100"), On_IRed: SGR("0;101"), On_IGreen: SGR("0;102"),
    On_IYellow: SGR("0;103"), On_IBlue: SGR("0;104"),
    On_IPurple: SGR("0;105"), On_ICyan: SGR("0;106"), On_IWhite: SGR("0;107"),

    Reset: SGR("0"), Bright: SGR("1"), Dim: SGR("2"),
    Underscore: SGR("4"), Blink: SGR("5"),
    Reverse: SGR("7"), Hidden: SGR("8"),

    FgBlack: SGR("30"), FgRed: SGR("31"), FgGreen: SGR("32"),
    FgYellow: SGR("33"), FgBlue: SGR("34"), FgMagenta: SGR("35"),
    FgCyan: SGR("36"), FgWhite: SGR("37"),

    BgBlack: SGR("40"), BgRed: SGR("41"), BgGreen: SGR("42"),
    BgYellow: SGR("43"), BgBlue: SGR("44"), BgMagenta: SGR("45"),
    BgCyan: SGR("46"), BgWhite: SGR("47"),
});
