﻿import * as fs from "fs";
import * as glob from "glob";
import Parser = require("onec-syntaxparser");
import * as path from "path";
import * as vscode from "vscode";

import { IBslMethodValue, ILanguageInfo, IMethodValue } from "./IMethodValue";

const Gherkin = require("gherkin");
const parser = new Gherkin.Parser();

const loki = require("lokijs");

export class Global {
    public static create(adapter?: any): Global {
        if (!Global.instance) {
            Global.instance = new Global(adapter);
        }
        return Global.instance;
    }

    private static instance: Global;

    private cache: any;
    private db: any;
    private dbsnippets: any;
    private languages: any;

    private cacheUpdates: Map<string, boolean>;
    private allCacheUpdated: boolean;

    constructor(adapter?: any) {
        this.cache = new loki("gtags.json");
        this.cacheUpdates = new Map<string, boolean>();

        if (adapter) {
            this.redefineMethods(adapter);
        }
    }

    public getCacheLocal(
        filename: string,
        word: string,
        source,
        update: boolean = false,
        allToEnd: boolean = true,
        fromFirst: boolean = true): IMethodValue[] {

        const suffix = allToEnd ? "" : "$";
        const prefix = fromFirst ? "^" : "";
        const querystring = { snippet: { $regex: new RegExp(prefix + word + suffix, "i") } };
        const entries = this.parseFeature(source, filename).find(querystring);
        return entries;
    }

    public queryref(word: string, local = false): any {
        const prefix = local ? "" : ".";
        const querystring = { name: { $regex: new RegExp(prefix + word + "", "i") } };
        const search = this.dbsnippets.chain().find(querystring).simplesort("name").data();
        return search;
    }

    public updateCacheForAll() {
        this.allCacheUpdated = false;
        if (vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0) {
            vscode.workspace.workspaceFolders.forEach((element) => {
                this.updateCache(element.uri.fsPath);
            });

        }
        this.allCacheUpdated = true;
    }

    public updateCache(rootPath: string): any {
        this.cacheUpdates.set(rootPath, true);

        this.db = this.cache.addCollection("ValueTable");
        this.dbsnippets = this.cache.addCollection("Calls");
        this.languages = this.cache.addCollection("Languages");

        const config = this.getProductConfiguration();
        if (config) {
            const pathsLibrarys: string[] = config.get<string[]>("featureLibraries", []);

            for (const library of pathsLibrarys) {
                this.findAllFilesForUpdate(library, rootPath, "Feature libraries cache is built.");
            }

            if (rootPath) {
                let featuresPath = String(config.get("featuresPath"));
                if (!featuresPath) {
                    // default path is rootPath + ./features
                    featuresPath = "./features";
                }
                this.findAllFilesForUpdate(featuresPath, rootPath, "Features' cache is built.");
            }

            const bslsPaths: string[] = config.get<string[]>("srcBslPath", []);
            for (let blspath of bslsPaths) {
                if (!(blspath.endsWith("/") || blspath.endsWith("\\"))) {
                    blspath += "/";
                }
                blspath = path.resolve(rootPath, blspath);
                this.findFilesBslForUpdate(blspath, "Bsl snippets search.");
            }
        }
    }

    public updateCacheOfTextDocument(uri): any {
        this.db.removeWhere((obj) => obj.filename === uri.fsPath);
        this.addFileToCache(uri);
    }

    public query(filename: vscode.Uri, word: string, all: boolean = true, lazy: boolean = false): any {
        if (!this.updateCacheIfNotUpdatedYet(filename)) {
            return new Array();
        }

        const prefix = lazy ? "" : "^";
        const suffix = all ? "" : "$";
        const querystring = { name: { $regex: new RegExp(prefix + word + suffix, "i") } };
        const search = this.db.chain().find(querystring).limit(50).simplesort("name").data();
        return search;
    }

    public queryAny(filename: vscode.Uri, word: string): any {
        this.updateCacheIfNotUpdatedYet(filename);

        const words = word.split(" ");
        const sb: string[] = new Array();
        words.forEach((element) => {
            sb.push("(?=.*");
            sb.push(element);
            sb.push(")");
        });
        sb.push(".+");
        const querystring = { name: { $regex: new RegExp(sb.join(""), "i") } };
        const search = this.db.chain().find(querystring).simplesort("name").data();
        return search;
    }

    public querySnippet(filename: vscode.Uri, word: string, all: boolean = true, lazy: boolean = false): any {
        this.updateCacheIfNotUpdatedYet(filename);

        const prefix = lazy ? "" : "^";
        const suffix = all ? "" : "$";
        const snipp = this.toSnippet(word);
        const snippFuzzy = this.toSnippet(word, false);
        const snippFuzzyRegPattern = snippFuzzy.replace(/\s/g, ".*");
        console.log("querySnippet snippFuzzyRegPattern " + snippFuzzyRegPattern);
        const regPattern = "(" + snipp + ")|(" + snippFuzzyRegPattern + ")";
        console.log("querySnippet regPattern " + regPattern);
        const querystring = { snippet: { $regex: new RegExp(regPattern, "i") } };
        const search = this.db.chain().find(querystring).limit(15).simplesort("snippet").data();
        return search;
    }

    public queryExportSnippet(filename: vscode.Uri, word: string, all: boolean = true, lazy: boolean = false): any {
        this.updateCacheIfNotUpdatedYet(filename);

        const prefix = lazy ? "" : "^";
        const suffix = all ? "" : "$";
        const snipp = this.toSnippet(word);
        const querystring = { snippet: { $regex: new RegExp(prefix + snipp + suffix, "i") } };

        function filterByExport(obj) {
            return obj.isexport;
        }
        const search = this.db.chain().find(querystring).where(filterByExport)
                            .limit(15)
                            .simplesort("snippet")
                            .data();
        return search;

    }
    public getLanguageInfo(filename: vscode.Uri): ILanguageInfo {

        if (!this.updateCacheIfNotUpdatedYet(filename)) {
            const languageInfo: ILanguageInfo = {
                language: "en",
                name: filename.fsPath,
            };
            return languageInfo;
        }

        return this.languages.findOne({ name: filename.fsPath });
    }

    public toSnippet(stringLine: string, getsnippet: boolean = true): string {
        const re3Quotes = new RegExp(/('''([^''']|'''''')*''')/, "g");
        const re1Quotes = new RegExp(/('([^']|'')*')/, "g");
        const re2Quotes = new RegExp(/("([^"]|"")*")/, "g");
        const re = new RegExp(/(<([^<]|<>)*>)/, "g");
        const reSpaces = new RegExp(/\s/, "g");
        let result = stringLine
                        .replace(re3Quotes, getsnippet ? "" : "''''''")
                        .replace(re1Quotes, getsnippet ? "" : "''")
                        .replace(re2Quotes, getsnippet ? "" : "\"\"")
                        .replace(re, getsnippet ? "" : "<>");
        if (getsnippet) {
            result = result.replace(reSpaces, "");
        }
        return result;
    }

    public async waitForCacheUpdate() {
        while (!this.cacheUpdated()) {
            await this.delay(100);
        }
    }

    public redefineMethods(adapter) {
        const methodsList = [
            "postMessage",
            "getConfiguration",
            "getConfigurationKey",
            "getRootPath"
            // , "findFilesForCache"
        ];
        methodsList.forEach((element) => {
            if (adapter.hasOwnProperty(element)) {
                this[element] = adapter[element];
            }
        });
    }

    public postMessage(description: string, interval?: number) { } // tslint:disable-line:no-empty

    public getConfiguration(section: string): vscode.WorkspaceConfiguration | undefined { return undefined; }

    public getConfigurationKey(configuration, key: string): any { } // tslint:disable-line:no-empty

    public getRootPath(): string {
        return "";
    }

    private getProductConfiguration(): vscode.WorkspaceConfiguration | undefined {
        return this.getConfiguration("gherkin-autocomplete");
    }

    // public findFilesForCache(_searchPattern: string, _rootPath: string) { } // tslint:disable-line:no-empty

    private findAllFilesForUpdate(checkPathParam: string, rootPath: string, msg: string) {
        if (!(checkPathParam.endsWith("/") || checkPathParam.endsWith("\\"))) {
            checkPathParam += "/";
        }
        const checkPath = path.resolve(rootPath, checkPathParam);
        this.findFilesForUpdate(checkPath, msg);
        this.findFilesBslForUpdate(checkPath, "Bsl snippets search.");
        this.findFilesBslForUpdate(checkPath, "OneScript snippets search.", true);
        return checkPath;
    }

    private findFilesForUpdate(library: string, successMessage: string): void {
        const globOptions: glob.IOptions = {};
        globOptions.dot = true;
        globOptions.cwd = library;
        globOptions.nocase = true;
        // glob >=7.0.0 contains this property
        // tslint:disable-next-line:no-string-literal
        globOptions["absolute"] = true;
        glob("**/*.feature", globOptions, (err, files) => {
            if (err) {
                console.error(err);
                return;
            }
            for (const file of files) {
                try {
                    this.addFileToCache(vscode.Uri.file(file));
                } catch (error) {
                    console.error(file + ":" + error);
                }
            }
            vscode.window.setStatusBarMessage(successMessage, 3000);
        });
    }

    private findFilesBslForUpdate(modulepath: string, successMessage: string, findOneScript?: boolean): void {
        const globOptions: glob.IOptions = {};
        globOptions.dot = true;
        globOptions.cwd = modulepath;
        globOptions.nocase = true;
        // glob >=7.0.0 contains this property
        // tslint:disable-next-line:no-string-literal
        globOptions["absolute"] = true;
        const filemask = "**/*." + (findOneScript ? "os" : "bsl");
        glob(filemask, globOptions, (err, files) => {
            if (err) {
                console.error(err);
                return;
            }
            for (const file of files) {
                try {
                    this.addSnippetsToCache(vscode.Uri.file(file), findOneScript);
                } catch (error) {
                    console.error(file + ":" + error);
                }
            }
            vscode.window.setStatusBarMessage(successMessage, 3000);
        });

    }

    private addFileToCache(uri: vscode.Uri) {
        const fullpath = uri.fsPath;
        const source = fs.readFileSync(fullpath, "utf-8");
        const entries = this.parseFeature(source, fullpath).find();
        let count = 0;
        for (const item of entries) {
            const newItem: IMethodValue = {
                description: item.description,
                endline: item.endline,
                filename: fullpath,
                isexport: item.isexport,
                kind: vscode.CompletionItemKind.Module,
                line: item.line,
                name: item.name,
                id: item.name.toLowerCase(),
                snippet: item.snippet
            };
            ++count;
            this.db.insert(newItem);
        }
    }

    private parseSnippets(source: string, filename: string, findOneScript?: boolean): any {

        const parsedModule = new Parser().parse(source);
        const methodsTable = parsedModule.getMethodsTable();

        const descrMethod = findOneScript ? "ПолучитьСписокШагов" : "ПолучитьСписокТестов";
        const re = findOneScript ?
            /ВсеШаги\.Добавить\(\"(.+)\"\);/igm
            : /\.ДобавитьШагВМассивТестов\([a-zA-Zа-яА-Я]+\,\".*\","([a-zA-Zа-яА-Я]+)\"/igm;

        const descrMethodEntries = methodsTable.findOne(
                { isexport : { $eq : true }, name : descrMethod });
        if (descrMethodEntries) {

            const stepnames = new Array();
            let matches = re.exec(source);
            while (matches  !== null) {
                stepnames.push(matches[1]);
                matches = re.exec(source);
            }

            const entries = methodsTable.find(
                { isexport : { $eq : true }, name: { $in : stepnames }}); // TODO нужно ли сравнивать с учетом регистра?
            return entries;
        } else {
            return [];
        }
    }

    private addSnippetsToCache(uri: vscode.Uri, findOneScript?: boolean) {
        const fullpath = uri.fsPath;
        const source = fs.readFileSync(fullpath, "utf-8");
        const entries = this.parseSnippets(source, fullpath, findOneScript);

        for (const item of entries) {
            const method = {
                context: item.context,
                endline: item.endline,
                isproc: item.isproc,
                name: item.name
            };

            const dbMethod = {
                IsExport: item._method.IsExport,
                Params: item._method.Params
            };
            const newItem: IBslMethodValue = {
                name: String(item.name),
                // tslint:disable-next-line:object-literal-sort-keys
                isproc: Boolean(item.isproc),
                isExport: Boolean(item._method.IsExport),
                line: item.line,
                endline: item.endline,
                context: item.context,
                _method: dbMethod,
                filename: fullpath,
                // module: moduleStr,
                description: item.description
            };
            this.dbsnippets.insert(newItem);
        }
    }

    private parseFeature(source: string, filename: string): any {

        const lockdb = new loki("loki.json");
        const methods = lockdb.addCollection("ValueTable");
        let gherkinDocument;
        try {
            gherkinDocument = parser.parse(source);
        } catch (error) {
            console.log("error parse file " + filename + ":" + error);
            return methods;
        }
        let languageInfo: ILanguageInfo;
        try {
            languageInfo = {
                language: gherkinDocument.feature.language,
                name: filename,
            };
        } catch (error) {
            console.error("error parse language " + filename + ":" + error);
            return methods;
        }

        this.languages.insert(languageInfo);
        if (!gherkinDocument.feature.children) {
            return methods;
        }

        const children = gherkinDocument.feature.children;
        let isExport = false;
        for (const tag of gherkinDocument.feature.tags) {
            const tagname: string = tag.name;
            if (tagname.toLowerCase().localeCompare("@ExportScenarios".toLowerCase()) === 0) {
                isExport = true;
                break;
            }
        }

        for (const child of children) {
            if (isExport && !(child.name.length === 0 || !child.name.trim())) {
                const text: string = child.name;
                const methRow: IMethodValue = {
                    description: text,
                    endline: child.location.line,
                    filename,
                    isexport: true,
                    line: child.location.line,
                    name: text,
                    id: text.toLowerCase(),
                    snippet: this.toSnippet(text)
                };
                methods.insert(methRow);
            }
            const steps = child.steps;

            for (const step of steps) {
                const text: string = step.text;
                const methRow: IMethodValue = {
                    description: step.text,
                    endline: step.location.line,
                    filename,
                    isexport: false,
                    line: step.location.line,
                    name: this.toSnippet(text, false),
                    id: this.toSnippet(text, false).toLowerCase(),
                    snippet: this.toSnippet(text)
                };

                methods.insert(methRow);
            }

        }

        return methods;
    }

    private delay(milliseconds: number) {
        return new Promise<void>((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }

    private cacheUpdated(): boolean {
        return this.allCacheUpdated;
    }

    // return true if already updated and false for not
    private updateCacheIfNotUpdatedYet(filename: vscode.Uri) {
        const rootFolder = vscode.workspace.getWorkspaceFolder(filename);
        if (!rootFolder) {
            return false;
        }
        if (!this.cacheUpdates.get(rootFolder.uri.fsPath)) {
            this.updateCache(rootFolder.uri.fsPath);
            return false;
        }
        return true;
    }
}
