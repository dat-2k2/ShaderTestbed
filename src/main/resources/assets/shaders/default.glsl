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

in vec3 fragCoord;
const vec3 BASECOLOR = vec3(0.7, 0., 0.);
const float ROUGHNESS = 0.5;

#define saturate(x) clamp(x, 0.0, 1.0)
#define PI 3.14159265359
#define IN_SPHERE 15.0
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
    int numSphere = 4;
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

    for (int i = 0; i < 10000; i++) {
        float hit = scene(origin + d * t);
        if (hit < 0.002 || t > 400.0){
            material = IN_SPHERE;
            break;
        }
        t += hit;
    }

    //out of time
    if (t > 400.0) {
        material = -1.0;
    }

    return vec2(t, material);
}

vec3 normal(in vec3 position) {
    vec3 epsilon = vec3(0.001, 0.0, 0.0);
    vec3 n = vec3(
    scene(position + epsilon.xyy).x - scene(position - epsilon.xyy).x,
    scene(position + epsilon.yxy).x - scene(position - epsilon.yxy).x,
    scene(position + epsilon.yyx).x - scene(position - epsilon.yyx).x);
    return normalize(n);
}

float pow5(float x) {
    float x2 = x * x;
    return x2 * x2 * x;
}

//Implement TR
float D_GGX(float roughness, float NoH, const vec3 h) {
    //Trowbridge-Reitz
    float alpha2 = roughness*roughness;
    float partialDenom = NoH*NoH*(alpha2-1.)+1.;
    return alpha2 / (PI * partialDenom * partialDenom);
}

float V_SmithGGXCorrelated(float roughness, float NoV, float NoL) {
    // Disney's modification of Smith
    float k = (roughness + 1.)*(roughness + 1.)/8.;
    float GGXV = NoV/(NoV*(1.-k)+k);
    float GGXL = NoL/(NoL*(1.-k)+k);
    return GGXV*GGXL;
}

vec3 F_Schlick(const vec3 f0, float VoH, float roughness) {
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


vec3 render(in vec3 origin, in vec3 direction, in vec3 l, out float distance) {
    vec3 color = vec3(0.5);

    // (distance, material)
    vec2 hit = traceRay(origin, direction);
    distance = hit.x;

    float material = hit.y;

    // We've hit something in the scene
    if (material > 0.0) {
        vec3 position = origin + distance * direction;

        vec3 v = normalize(-direction);
        vec3 n = normal(position);
        vec3 h = normalize(v + l);

        float NoV = abs(dot(n, v)) + 1e-5; //prevent orthogonal
        float NoL = saturate(dot(n, l));
        float NoH = saturate(dot(n, h));
        float LoH = saturate(dot(l, h));

        //0.1,0.2,0.3,0.4,0.5
        float linearRoughness = ROUGHNESS * ROUGHNESS;
        vec3 diffuseColor = BASECOLOR.rgb;

        //calculate f0 from IOR and metalness
        vec3 f0 = vec3(0.04);

        // specular BRDF
        float D = D_GGX(linearRoughness, NoH, h);
        float V = V_SmithGGXCorrelated(linearRoughness, NoV, NoL);
        vec3  F = F_Schlick(f0, LoH, linearRoughness);
        vec3 Fr = D * F * V /(4.*NoV*NoL);

        // diffuse BRDF
        vec3 Fd = diffuseColor * Fd_Burley(linearRoughness, NoV, NoL, LoH);

        color = Fd + Fr;
    }
    else{
        color = vec3(0.5);
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

vec3 iResolution = vec3(860,640,0);
out vec4 fragColor;

void main() {

    // Normalized coordinates
    vec2 p =  vec2(0.,0.3)+fragCoord.xy ;
    // Aspect ratio
   p.x *= iResolution.x / iResolution.y;

    // Camera position and "look at"
    vec3 origin = vec3(2., 0., 0.);
    vec3 target = vec3(0.);

    int lightX = 1;
    int lightY = 2;

    mat3 toWorld = setCamera(origin, target, 0.);
    vec3 direction = toWorld * normalize(vec3(p.xy, 2.0));

    // Render scene
    float distance;
    vec3 color = render(origin, direction, vec3(3.,0.,0.), distance);

    color = OECF_sRGBFast(color);
    fragColor = vec4(color, 1.0);
}
