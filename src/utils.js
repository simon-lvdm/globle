import * as THREE from 'three';
import * as turf from '@turf/turf';

// Earth radius in game units
export const EARTH_RADIUS = 5;

/**
 * Converts latitude and longitude to a Vector3 on a sphere.
 * @param {number} lat Latitude in degrees
 * @param {number} lon Longitude in degrees
 * @param {number} radius Sphere radius
 * @returns {THREE.Vector3}
 */
export function latLonToVector3(lat, lon, radius = EARTH_RADIUS) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));

    return new THREE.Vector3(x, y, z);
}

/**
 * Calculates the distance between two countries.
 * Priority:
 * 1. If same country -> 0
 * 2. If adjacent (share border) -> 0
 * 3. Else -> Distance from guessed country's centroid to target country's border (approx).
 * 
 * @param {object} guessFeature GeoJSON feature of guess
 * @param {object} targetFeature GeoJSON feature of target
 * @returns {number} Distance in kilometers
 */
export function calculateDistance(guessFeature, targetFeature) {
    if (!guessFeature || !targetFeature) return 0;

    // 1. Check if same
    if (guessFeature.properties.NAME === targetFeature.properties.NAME) return 0;

    // 2. Check adjacency
    // turf.booleanTouches checks if they share a border
    // turf.booleanIntersects might be safer for messy geometry
    try {
        if (turf.booleanTouches(guessFeature, targetFeature) || turf.booleanIntersects(guessFeature, targetFeature)) {
            return 0;
        }
    } catch (e) {
        console.warn('Adjacency check failed, falling back to distance', e);
    }

    // 3. Distance to closest border
    // Calculating true polygon-to-polygon distance is expensive.
    // We will approximate: Distance from Guess Centroid to Target Polygon (closest point on border)

    const guessCentroid = turf.centroid(guessFeature);

    // turf.pointToLineDistance calculates distance from point to line (border)
    // We need to convert target polygon to lines
    const targetLines = turf.polygonToLine(targetFeature);

    let minDistance = Infinity;

    // targetLines can be Feature or FeatureCollection (if MultiPolygon)
    if (targetLines.type === 'FeatureCollection') {
        targetLines.features.forEach(line => {
            const dist = turf.pointToLineDistance(guessCentroid, line, { units: 'kilometers' });
            if (dist < minDistance) minDistance = dist;
        });
    } else {
        minDistance = turf.pointToLineDistance(guessCentroid, targetLines, { units: 'kilometers' });
    }

    return minDistance;
}

/**
 * Interpolates color based on distance.
 * @param {number} distance Distance in km
 * @param {number} maxDistance Max possible distance (approx 20000km)
 * @returns {THREE.Color}
 */
export function getDistanceColor(distance, maxDistance = 20000) {
    // 0km -> Red (#ff0000) - This covers adjacent countries too
    if (distance === 0) return new THREE.Color(0xff0000);

    // Gradient:
    // 0 - 2000km: Red to Orange
    // 2000 - 8000km: Orange to Yellow
    // 8000+ : Yellow to Pale Brown

    const color = new THREE.Color();

    if (distance < 2000) {
        // Red (0xff0000) -> Orange (0xffa500)
        color.lerpColors(new THREE.Color(0xff0000), new THREE.Color(0xffa500), distance / 2000);
    } else if (distance < 8000) {
        // Orange (0xffa500) -> Yellow (0xffff00)
        color.lerpColors(new THREE.Color(0xffa500), new THREE.Color(0xffff00), (distance - 2000) / 6000);
    } else {
        // Yellow (0xffff00) -> Pale Brown (0xd2b48c)
        // Actually let's go to a very pale color for far
        color.lerpColors(new THREE.Color(0xffff00), new THREE.Color(0xd2b48c), (distance - 8000) / 12000);
    }

    return color;
}
