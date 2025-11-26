function getReliabilityColor(score) {
    if (score >= 80) return "green";
    if (score >= 60) return "yellow";
    if (score >= 40) return "orange";
    return "red";
}

function getReliabilityLabel(score) {
    if (score >= 80) return "Uy tín cao";
    if (score >= 60) return "Khá";
    if (score >= 40) return "Thấp";
    return "Rủi ro";
}

module.exports = {
    getReliabilityColor,
    getReliabilityLabel,
};