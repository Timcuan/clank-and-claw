export const UI_ACTIONS = {
    MENU: 'm_menu',
    WIZARD: 'm_wizard',
    SETTINGS: 'm_settings',
    FALLBACK: 'm_fallback',
    SET_NAME: 'm_name',
    SET_SYMBOL: 'm_symbol',
    SET_FEES: 'm_fees',
    FEE_PRESET_6: 'm_fee_6',
    FEE_PRESET_5: 'm_fee_5',
    SET_CONTEXT: 'm_context',
    SET_IMAGE: 'm_image',
    SET_SPOOF: 'm_spoof',
    PROFILES: 'm_profiles',
    PROFILE_SAVE: 'pf_save',
    PROFILE_LOAD: 'pf_load',
    PROFILE_DELETE: 'pf_delete',
    STATUS: 'm_status',
    HEALTH: 'm_health',
    DEPLOY: 'm_deploy',
    CANCEL: 'm_cancel',
    HELP: 'm_help',
    WIZ_FEE_6: 'w_fee_6',
    WIZ_FEE_5: 'w_fee_5',
    WIZ_SKIP_IMAGE: 'w_skip_img',
    WIZ_SKIP_CONTEXT: 'w_skip_ctx',
    FB_AUTOFILL: 'fb_autofill',
    FB_CLEAR_IMAGE: 'fb_clear_img',
    FB_CLEAR_CONTEXT: 'fb_clear_ctx',
    FB_CLEAR_SOCIALS: 'fb_clear_socials'
};

export const IMAGE_INPUT_STATES = new Set(['menu_image', 'wizard_image']);
export const PROFILE_INPUT_STATES = new Set(['menu_profile_save', 'menu_profile_load', 'menu_profile_delete']);

export const canAcceptImageInput = (session) => IMAGE_INPUT_STATES.has(String(session?.state || ''));

export const getReadyStatus = (token) => {
    const missing = [];
    const name = String(token?.name || '').trim();
    const symbol = String(token?.symbol || '').trim();
    const clankerFee = Number(token?.fees?.clankerFee);
    const pairedFee = Number(token?.fees?.pairedFee);

    if (!name) missing.push('name');
    if (!symbol) missing.push('symbol');
    if (!Number.isFinite(clankerFee) || !Number.isFinite(pairedFee) || clankerFee < 0 || pairedFee < 0) {
        missing.push('fees');
    }

    const contextId = String(token?.context?.messageId || '').trim();
    const imageValue = String(token?.image || '').trim();
    return {
        ready: missing.length === 0,
        missing,
        hasContext: contextId.length > 0,
        hasImage: imageValue.length > 0
    };
};

export const getPanelButtons = (token, ready) => {
    const deployLabel = ready ? 'Deploy' : 'Validate';

    return [
        [{ text: deployLabel, data: UI_ACTIONS.DEPLOY }, { text: 'Wizard', data: UI_ACTIONS.WIZARD }],
        [{ text: 'Settings', data: UI_ACTIONS.SETTINGS }, { text: 'Status', data: UI_ACTIONS.STATUS }],
        [{ text: 'Health', data: UI_ACTIONS.HEALTH }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
    ];
};

export const getSettingsButtons = (token) => {
    const spoofLabel = token?.spoofTo ? 'Spoof: On' : 'Spoof: Off';
    return [
        [{ text: 'Name', data: UI_ACTIONS.SET_NAME }, { text: 'Symbol', data: UI_ACTIONS.SET_SYMBOL }],
        [{ text: 'Fees', data: UI_ACTIONS.SET_FEES }, { text: 'Context', data: UI_ACTIONS.SET_CONTEXT }],
        [{ text: 'Image', data: UI_ACTIONS.SET_IMAGE }, { text: spoofLabel, data: UI_ACTIONS.SET_SPOOF }],
        [{ text: 'Profiles', data: UI_ACTIONS.PROFILES }, { text: 'Fallback', data: UI_ACTIONS.FALLBACK }],
        [{ text: 'Main Panel', data: UI_ACTIONS.MENU }]
    ];
};

export const getFallbackButtons = () => [
    [{ text: 'Auto-fill Missing', data: UI_ACTIONS.FB_AUTOFILL }, { text: 'Clear Image', data: UI_ACTIONS.FB_CLEAR_IMAGE }],
    [{ text: 'Clear Context', data: UI_ACTIONS.FB_CLEAR_CONTEXT }, { text: 'Clear Socials', data: UI_ACTIONS.FB_CLEAR_SOCIALS }],
    [{ text: 'Reset Session', data: UI_ACTIONS.CANCEL }, { text: 'Settings', data: UI_ACTIONS.SETTINGS }]
];

export const getProfileButtons = () => [
    [{ text: 'Save Preset', data: UI_ACTIONS.PROFILE_SAVE }, { text: 'Load Preset', data: UI_ACTIONS.PROFILE_LOAD }],
    [{ text: 'Delete Preset', data: UI_ACTIONS.PROFILE_DELETE }, { text: 'Settings', data: UI_ACTIONS.SETTINGS }],
    [{ text: 'Main Panel', data: UI_ACTIONS.MENU }]
];

export const renderFieldValue = (value, notSet = '_not set_') => {
    if (value === undefined || value === null) return notSet;
    const raw = String(value);
    if (raw.length === 0) return '`(empty)`';
    if (!raw.trim()) return '`(spaces)`';
    return raw;
};

export const formatSessionPanel = (session, title = '*Session Panel*') => {
    const t = session.token;
    const status = getReadyStatus(t);
    const totalFee = Number(t?.fees?.clankerFee || 0) + Number(t?.fees?.pairedFee || 0);
    const imageStatus = t.image ? 'Set' : 'Not set';
    const contextStatus = t.context?.messageId
        ? `${String(t.context.platform || 'unknown').toUpperCase()}`
        : 'Not set';
    const socialCount = Object.keys(t.socials || {}).length;
    const spoofStatus = t.spoofTo ? `ON (${t.spoofTo.slice(0, 8)}...)` : 'OFF';

    return {
        text: `
${title}
━━━━━━━━━━━━━━━━━━━━━
*Name:* ${renderFieldValue(t.name)}
*Symbol:* ${renderFieldValue(t.symbol)}
*Fees:* ${(totalFee / 100).toFixed(2)}% (${t?.fees?.clankerFee || 0}/${t?.fees?.pairedFee || 0} bps)
*Context:* ${contextStatus}
*Image:* ${imageStatus}
*Socials:* ${socialCount}
*Spoof:* ${spoofStatus}

${status.ready ? 'Ready to deploy' : 'Configure fields using buttons below'}
`.trim(),
        buttons: getPanelButtons(t, status.ready)
    };
};

export default {
    UI_ACTIONS,
    IMAGE_INPUT_STATES,
    PROFILE_INPUT_STATES,
    canAcceptImageInput,
    getReadyStatus,
    getPanelButtons,
    getSettingsButtons,
    getFallbackButtons,
    getProfileButtons,
    renderFieldValue,
    formatSessionPanel
};
