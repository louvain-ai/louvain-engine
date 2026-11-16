# retriever-vector

One leg: passages by meaning. It reads the verbatim tier in vector mode (`read/passages/search.ts`): the passages nearest
the search in the embedding space the workspace reads, under the reader's fence, and returns them as the leg `vector`.
The engine fuses it with the keyword retriever's leg and any other retriever's (`search/fused.ts`). A search asked by
its words alone (`mode: "keyword"`) reads nothing here. A read that fails is reported as `passages:vector` and costs
this leg only.

It takes no settings. The engine runs it by default, beside the keyword and figures retrievers.
