import * as path from "path";
import * as vscode from "vscode";

import { IMethodValue } from "../IMethodValue";
import AbstractProvider from "./abstractProvider";

const Gherkin = require("gherkin");
const parser = new Gherkin.Parser();
const Token = require("./../../../node_modules/gherkin/lib/gherkin/token");
const GherkinLine = require("./../../../node_modules/gherkin/lib/gherkin/gherkin_line");

export default class GlobalCompletionItemProvider extends AbstractProvider implements vscode.CompletionItemProvider {
    private added: object = {};

    // tslint:disable-next-line:max-line-length
    public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.CompletionItem | Thenable<vscode.CompletionItem> {

        return item;
    }

    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        cansellationToken: vscode.CancellationToken,
        context: vscode.CompletionContext): Thenable<vscode.CompletionItem[]> {

        this.added = {};

        return new Promise((resolve, reject) => {

            const bucket = new Array<vscode.CompletionItem>();
            const textLine: vscode.TextLine = document.lineAt(position.line);

            const filename = document.uri;
            let languageInfo = this._global.getLanguageInfo(filename);
            if (languageInfo == null) {
                let gherkinDocument;
                try {
                    gherkinDocument = parser.parse(document.getText());
                    languageInfo = {
                        language: gherkinDocument.feature.language,
                        name: document.uri.fsPath
                    };
                } catch (error) {
                    console.error("provideCompletionItems error parse file " + filename + ":" + error);
                    resolve(bucket);
                    return;
                }
            }
            const TokenMatcher = new Gherkin.TokenMatcher(languageInfo.language);

            const line = new GherkinLine(textLine.text, position.line);
            const token = new Token(line, position.line);
            const matches: boolean = TokenMatcher.match_StepLine(token);

            if (!matches) {
                console.log("not mathed token for " + textLine.text);
                return resolve(bucket);
            }

            const word: string = token.matchedText;
            const startPos = new vscode.Position(position.line, token.matchedKeyword.length);
            const replaceRange = new vscode.Range(startPos, position);

            const wordRange: vscode.Range | undefined = document.getWordRangeAtPosition(position);
            const wordcomplite: string = wordRange == null ? "" :
                document.getText(
                    new vscode.Range(wordRange.start, position)
            );
            console.log("compiler for <" + word + "> - filter <" + wordcomplite + ">");

            const snippet = this._global.toSnippet(word);
            const snippetFuzzy = this._global.toSnippet(word, false);

            // let result = this._global.queryExportSnippet(filename, snippet);
            let result = this._global.queryExportSnippet(filename, snippetFuzzy);
            result.forEach((value: IMethodValue, index: any, array: any) => {
                // const moduleDescription = "";
                // if (this.added[(moduleDescription + value.name).toLowerCase()] !== true) {
                if (this.added[value.id] !== true) {
                    const i = this.reverseIndex(snippet, value.name);
                    const item = new vscode.CompletionItem(value.name);
                    item.range = replaceRange;
                    item.insertText = value.name;
                    // item.insertText = wordcomplite + value.name.substr(i + 1);
                    item.sortText = "3";
                    item.filterText = value.name; // wordcomplite + value.snippet.toLowerCase() + " ";
                    // let startFilename = 0;
                    // if (value.filename.length - 60 > 0) {
                    //     startFilename = value.filename.length - 60;
                    // }
                    // item.documentation = (value.description ? value.description : ""); // +
                    //                    "\n" + value.snippet + ":" + value.line;

                    // const featureFilename = this.relativePath(vscode.Uri.file(value.filename));

                    // item.documentation = (value.description ? value.description + "\n" : "");
                    // item.documentation = (value.filename ? "Feature: " + featureFilename : "");
                    item.documentation = this.makeDocumentation(value);
                    item.kind = vscode.CompletionItemKind.Interface;
                    item.label = value.name; // value.name.substr(value.name.length - item.insertText.length);
                    bucket.push(item);
                    // this.added[(moduleDescription + value.name).toLowerCase()] = true;
                    this.added[value.id] = true;
                }
            });

            result = this._global.getCacheLocal(filename.fsPath, word, document.getText(), false);
            result.forEach((value: IMethodValue, index: any, array: any) => {
                // if (!this.added[value.name.toLowerCase()] === true) {
                if (!this.added[value.id] === true) {
                    if (value.name === word) { return; }

                    const i = this.reverseIndex(snippet, value.name);
                    const item = new vscode.CompletionItem(value.name);
                    item.sortText = "0";
                    item.insertText = wordcomplite + value.name.substr(i + 1);
                    item.filterText = value.name; // wordcomplite + value.snippet.toLowerCase() + " ";
                    item.range = replaceRange;

                    // item.documentation = value.description ? value.description : "";
                    item.documentation = this.makeDocumentation(value);
                    item.kind = vscode.CompletionItemKind.Function;
                    item.label = value.name;
                    item.label = value.name.substr(value.name.length - item.insertText.length);
                    bucket.push(item);
                    // this.added[value.name.toLowerCase()] = true;
                    this.added[value.id] = true;
                }
            });

            result = this._global.querySnippet(filename, snippetFuzzy);
            // result = this._global.querySnippet(filename, word);
            result.forEach((value: IMethodValue, index: any, array: any) => {
                // const moduleDescription = "";
                // if (this.added[(moduleDescription + value.name).toLowerCase()] !== true) {
                if (this.added[value.id] !== true) {
                    const i = this.reverseIndex(snippet, value.name);
                    const item = new vscode.CompletionItem(value.name);
                    item.insertText = value.name; // value.name.substr(word.length);
                    item.sortText = "0";
                    // item.insertText = value.name.substr(i + 1);
                    // item.insertText = wordcomplite + value.name.substr(i + 1);//TODO вставляет неверно
                    item.range = replaceRange;

                    item.filterText = value.name; // wordcomplite + value.snippet.toLowerCase() + " ";
                    item.label = value.name;
                    // let startFilename = 0;
                    // if (value.filename.length - 60 > 0) {
                    //     startFilename = value.filename.length - 60;
                    // }

                    // const featureFilename = this.relativePath(vscode.Uri.file(value.filename));

                    // item.documentation = (value.description ? value.description + "\n" : "");
                    // item.documentation = (value.filename ? "Feature: " + featureFilename : "");
                    item.documentation = this.makeDocumentation(value);
                    item.kind = value.kind ? value.kind : vscode.CompletionItemKind.Field;
                    bucket.push(item);
                    // this.added[(moduleDescription + value.name).toLowerCase()] = true;
                    this.added[value.id] = true;
                }
            });
            resolve(bucket);

            return;
        });
    }

    private makeDocumentation(value: IMethodValue): string {
        const featureFilename = this.relativePath(vscode.Uri.file(value.filename));
        let documentation = (value.description ? value.description + "\n" : "");
        documentation = (value.filename ? "Feature: " + featureFilename : "");
        return documentation;
    }

    private relativePath(filename: vscode.Uri) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(filename);
        let rootFolder: vscode.Uri = vscode.Uri.file(this._global.getRootPath());
        if (workspaceFolder && workspaceFolder.uri) {
            rootFolder = workspaceFolder.uri;
        }

        const relPath = path.relative(rootFolder.fsPath, filename.fsPath);

        // // If the path leaves the current working directory, then we need to
        // // resolve the absolute path so that the path can be properly matched
        // // by minimatch (via multimatch)
        // if (/^\.\.[\\/]/.test(relPath)) {
        //     relPath = path.resolve(relPath);
        // }
        return relPath;
    }

    private addOffset(str: string, regexp: RegExp, offsetObj: IObjOffset): string {
        let m;
        m = regexp.exec(str);
        if (m !== null) {
            offsetObj.offset = offsetObj.offset + m[0].length;
            str = str.substr(offsetObj.index + offsetObj.offset);
        }
        return str;
    }
    private  reverseIndex(snippet: string, fullSnippetString: string): number {
        const indexString: number = snippet.length - 1;
        const indexFull: number = fullSnippetString.length - 1;
        let i = 0;
        let offsetBase = 0;
        const re3Quotes = new RegExp(/^('''([^''']|'''''')*''')/, "i");
        const re1Quotes = new RegExp(/^('([^']|'')*')/, "i");
        const re2Quotes = new RegExp(/^("([^"]|"")*")/, "i");
        const re = new RegExp(/^(<([^<]|<>)*>)/, "i");
        const reSpaces = new RegExp(/^\s/, "i");
        const reWord = new RegExp(/\w|[а-яїєґ]/, "i");
        while (i < indexString) {
            const offsetObj: IObjOffset = {
                index: i,
                offset: offsetBase
            };
            while (
                (reWord.exec(fullSnippetString.charAt(offsetObj.index + offsetObj.offset)) == null)
                || (offsetObj.index + offsetObj.offset >= indexFull)
                ) {
                [reSpaces, re3Quotes, re1Quotes, re2Quotes, re].forEach((regElement) => {
                    this.addOffset(fullSnippetString.substr(
                        offsetObj.index + offsetObj.offset), regElement, offsetObj);
                });
                i = offsetObj.index;
                offsetBase = offsetObj.offset;
            }

            const char = snippet.charAt(i).toLowerCase();
            const baseStr = fullSnippetString.charAt(i + offsetBase).toLowerCase();
            if (char === baseStr) {
                i ++;
                continue;
            } else {
                break;
            }
        }
        return i + offsetBase;
    }
}

interface IObjOffset {
    index: number;
    offset: number;
}
