import { ADTClient, type AbapObjectStructure, type ObjectVersion } from "abap-adt-api";
/** abap-adt-api8.4.3 assumes include.atom:link is an array. A valid single link
 * is parsed as an object. Use the public raw request API and retain its documented
 * objectStructure shape, normalizing zero/one/many links without a private patch. */
export declare class CompatibleAdtClient extends ADTClient {
    objectStructure(objectUrl: string, version?: ObjectVersion): Promise<AbapObjectStructure>;
}
