import * as THREE from 'three';
import earcut from 'earcut';
import { latLonToVector3, EARTH_RADIUS } from './utils.js';

export class Globe {
    constructor(scene) {
        this.scene = scene;
        this.countriesGroup = new THREE.Group();
        this.scene.add(this.countriesGroup);
        this.countries = {}; // Map name -> Mesh
        this.countryData = []; // List of country data
    }

    async init() {
        // Create base sphere (ocean)
        const geometry = new THREE.SphereGeometry(EARTH_RADIUS - 0.05, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.6,
            metalness: 0.1,
        });
        const sphere = new THREE.Mesh(geometry, material);
        this.scene.add(sphere);

        // Load GeoJSON
        try {
            const response = await fetch('/countries.json');
            const data = await response.json();
            this.processGeoJSON(data);
        } catch (error) {
            console.error('Failed to load countries data:', error);
        }
    }

    processGeoJSON(data) {
        const features = data.features;

        features.forEach((feature) => {
            const name = feature.properties.NAME || feature.properties.ADMIN;
            if (!name) return;

            const geometry = feature.geometry;
            const meshes = [];

            if (geometry.type === 'Polygon') {
                const mesh = this.createCountryMesh(geometry.coordinates, name);
                if (mesh) meshes.push(mesh);
            } else if (geometry.type === 'MultiPolygon') {
                geometry.coordinates.forEach((coords) => {
                    const mesh = this.createCountryMesh(coords, name);
                    if (mesh) meshes.push(mesh);
                });
            }

            if (meshes.length > 0) {
                const countryGroup = new THREE.Group();
                countryGroup.userData = {
                    name: name,
                    centroid: this.calculateCentroid(feature)
                };

                meshes.forEach(mesh => {
                    mesh.userData.parentName = name;
                    countryGroup.add(mesh);
                });

                this.countriesGroup.add(countryGroup);
                this.countries[name] = countryGroup;
                this.countryData.push({
                    name: name,
                    centroid: countryGroup.userData.centroid,
                    feature: feature
                });
            }
        });
    }

    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    createCountryMesh(coordinates, name) {
        // coordinates is an array of linear rings
        // The first ring is the exterior, others are holes
        // earcut expects a flat array of vertices [x,y, x,y...] and an array of hole indices

        const vertices = [];
        const holes = [];
        let flatIndex = 0;

        coordinates.forEach((ring, i) => {
            if (i > 0) {
                holes.push(flatIndex / 2); // Index of the start of the hole
            }

            // Calculate signed area to determine winding using determinant formula
            // Area = 0.5 * sum(x1*y2 - x2*y1)
            // If Area > 0, it is CCW.
            // If Area < 0, it is CW.
            let area = 0;
            for (let j = 0, len = ring.length; j < len; j++) {
                const [x1, y1] = ring[j];
                const [x2, y2] = ring[(j + 1) % len];
                area += (x1 * y2 - x2 * y1);
            }

            const isCCW = area > 0;

            // Earcut expects:
            // Outer (i === 0): CCW
            // Inner (i > 0): CW

            let finalRing = ring;
            if (i === 0) {
                // If not CCW (i.e., is CW), reverse to make it CCW
                if (!isCCW) finalRing = [...ring].reverse();
            } else {
                // If not CW (i.e., is CCW), reverse to make it CW
                if (isCCW) finalRing = [...ring].reverse();
            }

            finalRing.forEach(([lon, lat]) => {
                vertices.push(lon, lat);
                flatIndex += 2;
            });
        });

        const triangles = earcut(vertices, holes);
        if (!triangles || triangles.length === 0) return null;

        const geometry = new THREE.BufferGeometry();
        const positions = [];
        const indices = [];

        // Convert 2D lat/lon vertices to 3D
        for (let i = 0; i < vertices.length; i += 2) {
            const lon = vertices[i];
            const lat = vertices[i + 1];
            const LAND_OFFSET = 1.05; // Adjust this value (e.g. 1.005 to 1.02)
            const vec = latLonToVector3(lat, lon, EARTH_RADIUS * LAND_OFFSET);
            positions.push(vec.x, vec.y, vec.z);
        }

        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        geometry.setIndex(triangles);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0x333333, // Default dark gray
            emissive: 0x000000,
            side: THREE.DoubleSide,
            roughness: 0.8,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        return mesh;
    }

    calculateCentroid(feature) {
        // Simple centroid approximation from bounding box or just use property if available
        // Natural Earth data usually doesn't have centroid prop, so we calculate
        // Or just take the center of the first polygon's bounding box
        // A better way is to use d3-geo-centroid if we had it, but we can approximate

        // Let's try to find a representative point
        // If it's a Polygon, average the vertices of the outer ring
        // If MultiPolygon, average the vertices of the largest polygon

        // Quick hack: just average all vertices of the first ring of the first polygon
        // This is "good enough" for a game usually

        let coords = feature.geometry.coordinates;
        if (feature.geometry.type === 'MultiPolygon') {
            coords = coords[0]; // First polygon
        }

        // coords is now [ring1, ring2...]
        const ring = coords[0]; // Outer ring

        let latSum = 0, lonSum = 0;
        ring.forEach(p => {
            lonSum += p[0];
            latSum += p[1];
        });

        return {
            lat: latSum / ring.length,
            lon: lonSum / ring.length
        };
    }

    highlightCountry(name, color) {
        const group = this.countries[name];
        if (group) {
            group.children.forEach(mesh => {
                mesh.material.color.set(color);
                mesh.material.emissive.set(color);
                mesh.material.emissiveIntensity = 0.5;
            });
        }
    }

    reset() {
        Object.values(this.countries).forEach(group => {
            group.children.forEach(mesh => {
                mesh.material.color.set(0x333333);
                mesh.material.emissive.set(0x000000);
            });
        });
    }
}
