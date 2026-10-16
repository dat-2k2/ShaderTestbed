#type vertex
#version 330 core
layout (location=0) in vec3 aPos;
layout (location=1) in vec4 aColor;

out vec3 fragCoord;
void main()
{
    fragCoord = aPos;
    gl_Position = vec4(aPos, 1.0);
}

#type fragment
#version 330 core

in vec3 fragCoord;
out vec4 fragColor;

// Set by the host (Scene.java on desktop, web/app.js in the browser)
uniform vec3  iResolution;     // framebuffer size in pixels
uniform float iTime;           // seconds since start
uniform vec3  uCameraPos;      // camera position, looking at the origin
uniform vec3  uBaseColor;      // linear base color
uniform float uRoughness;      // perceptual roughness [0, 1]
uniform float uMetallic;       // [0, 1]
uniform vec3  uLightDir;       // direction towards the light (normalized by the shader)
uniform float uLightIntensity;

#define saturate(x) clamp(x, 0.0, 1.0)
#define PI 3.14159265359
#define IN_SPHERE 15.0
#define MAX_STEPS 256
#define MAX_DIST 400.0
//------------------------------------------------------------------------------
// Distance field functions
//------------------------------------------------------------------------------


float sdSphere(in vec3 p, float s) {
    return length(p) - s;
}

float opUnion(float d1, float d2) {
    return min(d1,d2);
}

float scene(in vec3 position) {
    float radius = 0.2;
    float sphere1 = sdSphere(position - vec3(0.0, 0.0, 0.0), radius);
    float sphere2 = sdSphere(position - vec3(-0.5, 0.0, 0.0), radius);
    float sphere3 = sdSphere(position - vec3(0.5, 0.0, -0.5), radius);
    float sphere4 = sdSphere(position - vec3(0.0, 0.0, 0.5), radius);
    float finalRes = opUnion(opUnion(sphere1,sphere2), opUnion(sphere3,sphere4));
    return finalRes;
}

vec2 traceRay(in vec3 origin, in vec3 direction) {
    float material = -1.0;

    float t = 0.002;
    vec3 d = normalize(direction);

    for (int i = 0; i < MAX_STEPS; i++) {
        float hit = scene(origin + d * t);
        if (hit < 0.002) {
            material = IN_SPHERE;
            break;
        }
        t += hit;
        if (t > MAX_DIST) {
            break;
        }
    }

    return vec2(t, material);
}

vec3 normal(in vec3 position) {
    vec3 epsilon = vec3(0.001, 0.0, 0.0);
    vec3 n = vec3(
    scene(position + epsilon.xyy) - scene(position - epsilon.xyy),
    scene(position + epsilon.yxy) - scene(position - epsilon.yxy),
    scene(position + epsilon.yyx) - scene(position - epsilon.yyx));
    return normalize(n);
}

float pow5(float x) {
    float x2 = x * x;
    return x2 * x2 * x;
}

//Implement TR
float D_GGX(float alpha, float NoH) {
    //Trowbridge-Reitz
    float alpha2 = alpha*alpha;
    float partialDenom = NoH*NoH*(alpha2-1.)+1.;
    return alpha2 / (PI * partialDenom * partialDenom);
}

float V_SchlickGGX(float roughness, float NoV, float NoL) {
    // Epic's Schlick-GGX geometry term G with k = (roughness + 1)^2 / 8, already
    // divided by 4 NoV NoL. Folding the division in avoids 0/0 when NoL == 0.
    float k = (roughness + 1.)*(roughness + 1.)/8.;
    float GGXV = NoV*(1.-k)+k;
    float GGXL = NoL*(1.-k)+k;
    return 1. / (4. * GGXV * GGXL);
}

vec3 F_Schlick(const vec3 f0, float VoH) {
    return f0 + (vec3(1.0) - f0) * pow5(1.0 - VoH);
}

float F_Schlick(float f0, float f90, float VoH) {
    return f0 + (f90 - f0) * pow5(1.0 - VoH);
}

float Fd_Burley(float linearRoughness, float NoV, float NoL, float LoH) {
    // Burley 2012, "Physically-Based Shading at Disney"
    float f90 = 0.5 + 2.0 * linearRoughness * LoH * LoH;
    float lightScatter = F_Schlick(1.0, f90, NoL);
    float viewScatter  = F_Schlick(1.0, f90, NoV);
    return lightScatter * viewScatter * (1.0 / PI);
}


vec3 render(in vec3 origin, in vec3 direction, in vec3 l, out float dist) {
    vec3 color = vec3(0.5);

    // (distance, material)
    vec2 hit = traceRay(origin, direction);
    dist = hit.x;

    float material = hit.y;

    // We've hit something in the scene
    if (material > 0.0) {
        vec3 position = origin + dist * direction;

        vec3 v = normalize(-direction);
        vec3 n = normal(position);
        vec3 h = normalize(v + l);

        float NoV = abs(dot(n, v)) + 1e-5; //prevent orthogonal
        float NoL = saturate(dot(n, l));
        float NoH = saturate(dot(n, h));
        float LoH = saturate(dot(l, h));

        // Clamp to avoid a singular D at roughness 0
        float roughness = clamp(uRoughness, 0.045, 1.0);
        float linearRoughness = roughness * roughness;
        float metallic = saturate(uMetallic);
        vec3 diffuseColor = (1.0 - metallic) * uBaseColor;

        // dielectrics reflect ~4%, metals tint the reflection with the base color
        vec3 f0 = mix(vec3(0.04), uBaseColor, metallic);

        // specular BRDF
        float D = D_GGX(linearRoughness, NoH);
        float V = V_SchlickGGX(roughness, NoV, NoL);
        vec3  F = F_Schlick(f0, LoH);
        vec3 Fr = D * V * F;

        // diffuse BRDF
        vec3 Fd = diffuseColor * Fd_Burley(linearRoughness, NoV, NoL, LoH);

        // rendering equation for one directional light, plus a small ambient term
        color = (Fd + Fr) * NoL * uLightIntensity + 0.03 * uBaseColor;
    }

    return color;
}

//------------------------------------------------------------------------------
// Setup and execution
//------------------------------------------------------------------------------
vec3 OECF_sRGBFast(const vec3 linear) {
    return pow(linear, vec3(1.0 / 2.2));
}
mat3 setCamera(in vec3 origin, in vec3 target, float rotation) {
    vec3 forward = normalize(target - origin);
    vec3 orientation = vec3(sin(rotation), cos(rotation), 0.0);
    vec3 left = normalize(cross(forward, orientation));
    vec3 up = normalize(cross(left, forward));
    return mat3(left, up, forward);
}

void main() {

    // Normalized coordinates
    vec2 p = fragCoord.xy;
    // Aspect ratio
    p.x *= iResolution.x / iResolution.y;

    // Camera position and "look at"
    vec3 origin = uCameraPos;
    vec3 target = vec3(0.);

    mat3 toWorld = setCamera(origin, target, 0.);
    vec3 direction = toWorld * normalize(vec3(p.xy, 2.0));

    // Render scene
    float dist;
    vec3 color = render(origin, direction, normalize(uLightDir), dist);

    color = OECF_sRGBFast(max(color, 0.0));
    fragColor = vec4(color, 1.0);
}
