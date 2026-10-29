# Central OPEKA Keycloak with the GSIS (TAXISnet) identity providers.
# The plugin is compiled here against the same Keycloak version as the runtime image:
# a jar built for another Keycloak version can fail at runtime (SPI changes between releases).
# Keep KEYCLOAK_VERSION in sync with <keycloak.version> in gsis-plugin/pom.xml.
ARG KEYCLOAK_VERSION=26.8.1

# The plugin's Lombok does not support JDK 25, so build on 21 (also Keycloak 26's runtime JDK).
FROM maven:3.9.9-eclipse-temurin-21 AS plugin
WORKDIR /src
# `gsis-plugin` is a named build context (see compose.yaml): the gsis-plugin/ folder.
COPY --from=gsis-plugin . .
RUN mvn -B -q package -DskipTests && cp target/keycloak-gsis-providers-*.jar /keycloak-gsis-providers.jar

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION} AS builder
ENV KC_DB=postgres KC_HEALTH_ENABLED=true
COPY --from=plugin /keycloak-gsis-providers.jar /opt/keycloak/providers/
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
